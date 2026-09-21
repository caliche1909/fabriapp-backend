'use strict';

/**
 * 🔗 Engancha a su parada las 5 ventas que el teléfono mandó SIN `visit_id` el 2026-09-15.
 *
 * QUÉ PASÓ. Juan José ("Ruta de miga", ruta 35) abrió cinco tiendas nuevas en la calle y a cada una
 * le hizo una venta ocasional. La tienda recién creada entra en la lista del teléfono sin id de
 * parada (`createStore` no lo proyecta), la venta ocasional no recarga esa lista, y el cajón le
 * pasaba al punto de venta esa tienda: la venta salió con `visit_id: null`. El servidor la tomó por
 * una venta suelta y no tocó la parada, que se quedó `visited` con importe 0.
 *
 * CONSECUENCIA. El Cuadre del 15-sep no cuadra: "Total vendido" suma las paradas (1.871.400) y "por
 * método de pago" suma las ventas (2.167.400). La diferencia son exactamente estas cinco: 296.000.
 * Y las cinco tiendas figuran como NO VENTA cuando sí compraron.
 *
 * LA CAUSA YA ESTÁ CORREGIDA en el cliente (`utils/tiendaDeLaParada.ts`: el menú toma el id de la
 * fila). Esta migración repara solo lo que ya ocurrió. Diagnóstico completo en
 * `PENDING-IMPLEMENTATION.md` (hallazgos del 2026-09-16) y `OFFLINE-CAMPO.md` §14.9.
 *
 * QUÉ HACE, POR PAREJA — exactamente lo que habría hecho `createSale` si hubiera recibido la parada:
 *   · `sales.visit_id` ← la parada.
 *   · `store_visits.sale_amount` += el importe de la venta, y la parada pasa a `completed`.
 * El `user_id` de la parada no se toca (sigue siendo quien llegó), igual que en `createSale`.
 *
 * 🔴 LAS PAREJAS VAN ESCRITAS A MANO, Y ES A PROPÓSITO. Una regla general ("engancha toda venta
 * suelta a la parada de ese día") tocaría ventas que no conocemos. Aquí se sabe exactamente cuáles
 * son y por qué — medido sobre la copia de producción: son las ÚNICAS 5 ventas sin parada de toda
 * la historia.
 *
 * 🔴 ANTES DE ESCRIBIR, SE COMPRUEBA TODO, Y SI ALGO NO CUADRA, FALLA ENTERA. Producción puede haber
 * cambiado desde que se hizo la copia (alguien anuló una venta, borró una parada...). Enganchar
 * sobre datos que no son los que se analizaron sería inventar. Todo corre en una transacción: o
 * entran las cinco, o ninguna. La única excepción es la pareja ya enganchada, que se salta: así la
 * migración se puede repetir sin sumar dos veces.
 *
 * @type {import('sequelize-cli').Migration}
 */

const PAREJAS = [
    { venta: 12103, parada: 18939, tienda: 'SURTI CARNES PANDIACO' },
    { venta: 12107, parada: 18940, tienda: 'GRAN POLLO FRESCO ANGANOY' },
    { venta: 12110, parada: 18941, tienda: 'PUNTO DE LAS CARNES' },
    { venta: 12114, parada: 18942, tienda: 'DISTRIPOLLO' },
    { venta: 12121, parada: 18943, tienda: 'GRAN POLLO FRESCO POTRERILLO' },
];

/** Lee venta y parada, bloqueándolas, con todo lo necesario para comprobar la pareja. */
const leerPareja = async (sequelize, { venta, parada }, transaction) => {
    const [fila] = await sequelize.query(
        `SELECT s.id AS venta_id, s.visit_id, s.store_id AS venta_tienda, s.route_id AS venta_ruta,
                s.company_id AS venta_cia, s.status AS venta_estado, s.deleted_at AS venta_borrada,
                s.total_amount, to_char((s.sale_date AT TIME ZONE c.timezone)::date, 'YYYY-MM-DD') AS dia_venta,
                v.id AS parada_id, v.store_id AS parada_tienda, v.route_id AS parada_ruta,
                v.status AS parada_estado, v.sale_amount, to_char(v.visit_day, 'YYYY-MM-DD') AS visit_day,
                r.company_id AS parada_cia,
                (SELECT COALESCE(SUM(x.total_amount), 0) FROM sales x
                  WHERE x.visit_id = v.id AND x.deleted_at IS NULL) AS ya_enganchado
           FROM sales s
           JOIN companies c ON c.id = s.company_id
           JOIN store_visits v ON v.id = :parada
           JOIN routes r ON r.id = v.route_id
          WHERE s.id = :venta
          FOR UPDATE OF s, v`,
        { type: sequelize.QueryTypes.SELECT, replacements: { venta, parada }, transaction }
    );
    return fila || null;
};

const num = (v) => Number(v);

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const t = await sequelize.transaction();
        // Lo que se va a contar se guarda y se imprime DESPUÉS del commit. Si una pareja falla,
        // las anteriores se deshacen con el rollback, y un "+ sumados" impreso por el camino le
        // haría creer a quien lea el registro en producción que algo se aplicó.
        const informe = [];
        try {
            let enganchadas = 0;
            for (const p of PAREJAS) {
                const f = await leerPareja(sequelize, p, t);
                const etiqueta = `venta ${p.venta} → parada ${p.parada} (${p.tienda})`;
                if (!f) throw new Error(`${etiqueta}: la venta o la parada ya no existe.`);

                // Ya enganchada por una pasada anterior: no se vuelve a sumar.
                if (num(f.visit_id) === p.parada) {
                    informe.push(`   = ${etiqueta}: ya estaba enganchada, se salta.`);
                    continue;
                }

                // Las comprobaciones. Cada una protege de un cambio concreto en producción.
                const fallos = [];
                if (f.visit_id !== null) fallos.push(`la venta ya apunta a OTRA parada (${f.visit_id})`);
                if (f.venta_borrada !== null) fallos.push('la venta está anulada o apartada');
                if (f.venta_estado !== 'completed') fallos.push(`la venta está en '${f.venta_estado}'`);
                if (f.venta_tienda !== f.parada_tienda) fallos.push('venta y parada son de tiendas distintas');
                if (f.venta_ruta !== null && f.venta_ruta !== f.parada_ruta) fallos.push('venta y parada son de rutas distintas');
                if (f.venta_cia !== f.parada_cia) fallos.push('venta y parada son de compañías distintas');
                if (f.dia_venta !== f.visit_day) fallos.push(`día distinto (${f.dia_venta} vs ${f.visit_day})`);
                if (!['visited', 'completed'].includes(f.parada_estado)) fallos.push(`la parada está en '${f.parada_estado}'`);
                // El importe de la parada tiene que ser la suma de lo que ya tiene enganchado. Si no,
                // alguien lo tocó y sumarle encima descuadraría en vez de cuadrar.
                if (num(f.sale_amount) !== num(f.ya_enganchado)) {
                    fallos.push(`el importe de la parada (${f.sale_amount}) no es la suma de sus ventas (${f.ya_enganchado})`);
                }
                if (fallos.length) throw new Error(`${etiqueta}: ${fallos.join('; ')}. No se toca nada.`);

                await sequelize.query(
                    `UPDATE sales SET visit_id = :parada WHERE id = :venta AND visit_id IS NULL`,
                    { replacements: p, transaction: t }
                );
                await sequelize.query(
                    `UPDATE store_visits SET sale_amount = sale_amount + :importe, status = 'completed'
                      WHERE id = :parada`,
                    { replacements: { parada: p.parada, importe: f.total_amount }, transaction: t }
                );
                enganchadas += 1;
                informe.push(`   + ${etiqueta}: ${num(f.total_amount)} sumados, parada cerrada.`);
            }
            await t.commit();
            informe.forEach((linea) => console.log(linea));
            console.log(`   ${enganchadas} enganchadas, ${PAREJAS.length - enganchadas} ya lo estaban.`);
        } catch (error) {
            await t.rollback();
            console.log('   ✗ No se aplicó NINGUNA pareja: todo se deshizo.');
            throw error;
        }
    },

    /**
     * Deshace el enganche. OJO: vuelve a dejar el Cuadre del 15-sep DESCUADRADO, que es el estado
     * anterior. Solo sirve para revertir la migración, no para arreglar nada.
     *
     * Solo toca las parejas que siguen enganchadas entre sí. La parada vuelve a `visited` únicamente
     * si se queda sin importe y sin otras ventas: si alguien le hubiera sumado otra venta después,
     * se conserva `completed`, que es la verdad para esa otra venta.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const t = await sequelize.transaction();
        try {
            for (const p of PAREJAS) {
                const f = await leerPareja(sequelize, p, t);
                if (!f || num(f.visit_id) !== p.parada) continue;

                await sequelize.query(
                    `UPDATE sales SET visit_id = NULL WHERE id = :venta AND visit_id = :parada`,
                    { replacements: p, transaction: t }
                );
                await sequelize.query(
                    `UPDATE store_visits v
                        SET sale_amount = v.sale_amount - :importe,
                            status = CASE
                                WHEN v.sale_amount - :importe = 0
                                 AND NOT EXISTS (SELECT 1 FROM sales x WHERE x.visit_id = v.id AND x.deleted_at IS NULL)
                                THEN 'visited' ELSE v.status END
                      WHERE v.id = :parada`,
                    { replacements: { parada: p.parada, importe: f.total_amount }, transaction: t }
                );
            }
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
};
