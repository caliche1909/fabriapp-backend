'use strict';

/**
 * 🔑 UNA PARADA POR TIENDA, POR RUTA, POR DÍA.
 *
 * El UNIQUE actual es `(store_id, route_id, user_id, visit_day)`: con el usuario dentro de la
 * IDENTIDAD de la parada, **dos personas pueden sostener listas paralelas sobre la misma tienda
 * el mismo día y la base de datos lo aprueba**. Ese es el hueco por el que se cuela una segunda
 * jornada parada a parada (el 409 de `startRoute` solo mira al pulsar, no impide nada después).
 *
 * Con el modelo de "cambio de encargado" el `user_id` deja de ser identidad y pasa a ser un
 * ATRIBUTO —quién resolvió la parada—, así que el UNIQUE correcto es
 * `(store_id, route_id, visit_day)`, y entonces el invariante se defiende solo.
 *
 * ⚠️ EXIGE FUSIONAR LOS DUPLICADOS QUE YA EXISTEN. En dev había 7 grupos (14 filas) de rutas
 * 31/32/33 entre 2025-10-21 y 2026-05-16. La fusión:
 *   1. Elige un GANADOR por grupo: el estado más avanzado (completed > visited > pending); a
 *      igualdad, el que tenga venta o reporte de no-venta enganchado; a igualdad, el id menor.
 *   2. Re-apunta a él los hijos de los perdedores (`sales.visit_id`, `store_no_sale_reports.visit_id`)
 *      ANTES de borrar nada: `sales.visit_id` está en ON DELETE SET NULL, así que borrar primero
 *      desengancharía la venta EN SILENCIO en vez de fallar.
 *   3. Suma el `sale_amount` del grupo en el ganador (es como funciona de por sí: una visita
 *      acumula varias ventas).
 *   4. Borra los perdedores.
 *
 * Ningún dato de venta se pierde: las filas de `sales` sobreviven íntegras, cada una con su
 * `user_id` y su importe. Lo que se colapsa es el registro de la VISITA, que es justo lo que el
 * modelo nuevo dice que debe ser único.
 *
 * 🛑 Caso que NO se puede resolver solo: dos filas del mismo grupo con reporte de no-venta cada
 * una (`idx_unique_visit_report` es UNIQUE por `visit_id`). Si aparece, la migración FALLA con la
 * lista, para que se decida a mano en vez de perder un reporte en silencio.
 *
 * 🔁 `down` restaura el UNIQUE anterior, pero **la fusión no se deshace**: las filas borradas no
 * se pueden resucitar. Hacer respaldo antes de correrla en producción.
 */

// Grupos duplicados con su ganador elegido. Se reutiliza en cada paso de la fusión.
const CTE_ELEGIDOS = `
    WITH grupos AS (
        SELECT store_id, route_id, visit_day
          FROM store_visits
         WHERE route_id IS NOT NULL
         GROUP BY store_id, route_id, visit_day
        HAVING count(*) > 1
    ),
    filas AS (
        SELECT sv.id, sv.store_id, sv.route_id, sv.visit_day, sv.status, sv.sale_amount,
               (SELECT count(*) FROM sales s WHERE s.visit_id = sv.id)
             + (SELECT count(*) FROM store_no_sale_reports n WHERE n.visit_id = sv.id) AS hijos
          FROM store_visits sv
          JOIN grupos g ON g.store_id = sv.store_id
                       AND g.route_id = sv.route_id
                       AND g.visit_day = sv.visit_day
    ),
    elegidos AS (
        SELECT f.*,
               first_value(f.id) OVER (
                   PARTITION BY f.store_id, f.route_id, f.visit_day
                   ORDER BY CASE f.status WHEN 'completed' THEN 0 WHEN 'visited' THEN 1 ELSE 2 END ASC,
                            f.hijos DESC,
                            f.id ASC
               ) AS ganador
          FROM filas f
    )`;

module.exports = {
    async up(queryInterface, Sequelize) {
        const sequelize = queryInterface.sequelize;
        const t = await sequelize.transaction();
        const sel = (sql, opts = {}) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT, transaction: t, ...opts });

        try {
            // ── 0) Foto previa ────────────────────────────────────────────────
            const previos = await sel(`${CTE_ELEGIDOS}
                SELECT store_id, route_id, to_char(visit_day,'YYYY-MM-DD') AS visit_day,
                       count(*)::int AS filas, min(ganador)::int AS ganador
                  FROM elegidos GROUP BY 1,2,3 ORDER BY 3 DESC, 1`);

            if (previos.length === 0) {
                console.log('   ✔️ No hay paradas duplicadas por (tienda, ruta, día).');
            } else {
                console.log(`   ⚠️ ${previos.length} grupo(s) duplicado(s) por fusionar:`);
                for (const g of previos) {
                    console.log(`      · ruta ${g.route_id} · ${g.visit_day} · tienda ${g.store_id} → ${g.filas} filas, gana la ${g.ganador}`);
                }
            }

            // ── 1) Guardia: dos reportes de no-venta en un mismo grupo ────────
            const conflicto = await sel(`${CTE_ELEGIDOS}
                SELECT e.store_id, e.route_id, to_char(e.visit_day,'YYYY-MM-DD') AS visit_day,
                       count(*)::int AS reportes
                  FROM elegidos e
                  JOIN store_no_sale_reports n ON n.visit_id = e.id
                 GROUP BY 1,2,3 HAVING count(*) > 1`);

            if (conflicto.length > 0) {
                const detalle = conflicto
                    .map((c) => `ruta ${c.route_id} · ${c.visit_day} · tienda ${c.store_id} (${c.reportes} reportes)`)
                    .join('; ');
                throw new Error(
                    'No se puede fusionar automáticamente: hay grupos con MÁS DE UN reporte de no-venta, ' +
                    'y solo puede quedar uno por visita. Resuélvelos a mano y vuelve a correr la migración. → ' + detalle
                );
            }

            // ── 2) Re-apuntar los hijos al ganador (ANTES de borrar) ──────────
            const [, ventas] = await sequelize.query(`${CTE_ELEGIDOS}
                UPDATE sales s SET visit_id = e.ganador
                  FROM elegidos e
                 WHERE s.visit_id = e.id AND e.id <> e.ganador`, { transaction: t });
            const [, reportes] = await sequelize.query(`${CTE_ELEGIDOS}
                UPDATE store_no_sale_reports n SET visit_id = e.ganador
                  FROM elegidos e
                 WHERE n.visit_id = e.id AND e.id <> e.ganador`, { transaction: t });

            // ── 3) El ganador absorbe el monto del grupo ──────────────────────
            await sequelize.query(`${CTE_ELEGIDOS}
                , totales AS (SELECT ganador, sum(sale_amount) AS total FROM elegidos GROUP BY ganador)
                UPDATE store_visits sv SET sale_amount = tt.total, updated_at = now()
                  FROM totales tt
                 WHERE sv.id = tt.ganador AND sv.sale_amount IS DISTINCT FROM tt.total`, { transaction: t });

            // ── 4) Fuera los perdedores ───────────────────────────────────────
            const [, borradas] = await sequelize.query(`${CTE_ELEGIDOS}
                DELETE FROM store_visits sv USING elegidos e
                 WHERE sv.id = e.id AND e.id <> e.ganador`, { transaction: t });

            if (previos.length > 0) {
                console.log(`   → ${ventas.rowCount} venta(s) y ${reportes.rowCount} reporte(s) re-apuntados; ${borradas.rowCount} parada(s) duplicada(s) eliminada(s).`);
            }

            // ── 5) Verificar antes de poner el candado ────────────────────────
            const [{ quedan }] = await sel(`
                SELECT count(*)::int AS quedan FROM (
                    SELECT 1 FROM store_visits WHERE route_id IS NOT NULL
                     GROUP BY store_id, route_id, visit_day HAVING count(*) > 1) x`);
            if (quedan > 0) {
                throw new Error(`Tras la fusión aún quedan ${quedan} grupo(s) duplicado(s); no se crea el UNIQUE.`);
            }

            // ── 6) Cambiar el candado ─────────────────────────────────────────
            await queryInterface.removeConstraint('store_visits', 'uq_store_visits_daily', { transaction: t });
            await queryInterface.addConstraint('store_visits', {
                fields: ['store_id', 'route_id', 'visit_day'],
                type: 'unique',
                name: 'uq_store_visits_daily',
                transaction: t,
            });
            console.log('   ✔️ UNIQUE uq_store_visits_daily → (store_id, route_id, visit_day)');

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        // ⚠️ Solo se revierte el CANDADO. Las paradas fusionadas NO se pueden resucitar.
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.removeConstraint('store_visits', 'uq_store_visits_daily', { transaction: t });
            await queryInterface.addConstraint('store_visits', {
                fields: ['store_id', 'route_id', 'user_id', 'visit_day'],
                type: 'unique',
                name: 'uq_store_visits_daily',
                transaction: t,
            });
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
};
