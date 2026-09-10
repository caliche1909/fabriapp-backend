'use strict';

/**
 * 🔁 `client_operation_id` + `synced_at` — idempotencia y trazabilidad de la sincronización.
 *
 * Es la primera pieza de la operación de campo sin internet (ver `OFFLINE-CAMPO.md`, Fase 1a),
 * pero **arregla un problema que existe HOY**, con o sin offline.
 *
 * ── El problema ────────────────────────────────────────────────────────────────────────────
 * `createSale` admite **varias ventas por visita a propósito** (append-only: el vendedor puede
 * volver a venderle a la misma tienda) y **suma** el monto a la parada. No hay ninguna clave que
 * identifique "esta venta concreta". Consecuencia: si la venta llega al servidor, se graba, y la
 * RESPUESTA se pierde en el camino —cosa normal con mala cobertura, o si se agota el timeout de
 * 30 s del cliente—, el reintento **crea una segunda venta buena**. Dos juegos de `sale_items`,
 * dos salidas de stock y el doble en el Cuadre, en silencio.
 *
 * Hoy mismo se reproduce sin offline: un vendedor que toca "Registrar venta" dos veces porque la
 * primera parecía colgada está creando dos ventas.
 *
 * ── La solución ────────────────────────────────────────────────────────────────────────────
 * El CLIENTE genera un UUID por operación (`crypto.randomUUID()`) y lo manda **igual en todos los
 * reintentos**. El servidor busca ese UUID antes de crear nada: si ya lo vio, devuelve el recurso
 * que ya creó (200) en vez de crear otro. El índice único es el árbitro de último recurso para la
 * carrera de dos peticiones simultáneas.
 *
 * ── Por qué el índice es PARCIAL ───────────────────────────────────────────────────────────
 * `WHERE client_operation_id IS NOT NULL` es lo que permite que las 11.388 ventas, 17.641 paradas
 * y 5.548 reportes históricos —todos con NULL— convivan sin tocarse: en un índice único los NULL
 * no colisionan entre sí, y con el filtro parcial ni siquiera entran al índice. Ya hay precedente
 * del patrón en esta misma base: `idx_unique_visit_report` sobre `visit_id WHERE visit_id IS NOT NULL`.
 *
 * ── Por qué `synced_at` ────────────────────────────────────────────────────────────────────
 * Marca **cuándo llegó la fila al servidor** cuando no llegó en vivo. `NULL` = se registró en el
 * momento; con valor = venía de la cola offline. Hace falta una columna propia porque ninguna de
 * las tres tablas puede responder eso por su cuenta una vez que la fecha de negocio la pone el
 * cliente: en `sales` el `created_at` sirve de casualidad, en `store_visits` el `created_at` es la
 * hora en que se INICIÓ LA RUTA (la parada nace ahí, no al marcarla), y en
 * `store_no_sale_reports` el `created_at` **es** la fecha de negocio y se sobrescribe.
 *
 * No es un lujo de auditoría: es lo que permite explicar por qué un Cuadre que ya se revisó cambió
 * de número al día siguiente.
 *
 * ── Compatibilidad ─────────────────────────────────────────────────────────────────────────
 * Las dos columnas son **NULL y opcionales**. El frontend desplegado no las manda y los tres
 * endpoints se comportan **exactamente igual que hoy**. Backend y frontend se despliegan por
 * separado, así que esto puede subir solo y quedarse esperando.
 *
 * `ADD COLUMN ... NULL` sin DEFAULT no reescribe la tabla. Ensayado sobre la copia fiel de
 * producción: `ADD COLUMN` 1-17 ms y `CREATE UNIQUE INDEX` 21-83 ms por tabla.
 *
 * 🔁 Reversible: `down` quita índices y columnas. No hay tipos ENUM que limpiar.
 */

const TABLAS = ['sales', 'store_visits', 'store_no_sale_reports'];

const COMENTARIO_OP = 'UUID de la operación en el cliente. Idempotencia: el mismo valor en todos los '
    + 'reintentos identifica UNA sola operación. NULL = registro anterior a la sincronización offline.';
const COMENTARIO_SYNC = 'Cuándo llegó la fila al servidor si NO llegó en vivo (venía de la cola '
    + 'offline). NULL = se registró en el momento. La fecha de NEGOCIO va en sale_date / arrived_at / created_at.';

const nombreIndice = (tabla) => `uq_${tabla}_client_operation_id`;

module.exports = {
    async up(queryInterface, Sequelize) {
        const sequelize = queryInterface.sequelize;
        const t = await sequelize.transaction();

        try {
            for (const tabla of TABLAS) {
                // SQL directo e idempotente (IF NOT EXISTS), como el resto de migraciones de la
                // casa: se puede reaplicar sin romper y no depende de cómo Sequelize traduzca
                // `addColumn` + `comment` en Postgres.
                await sequelize.query(
                    `ALTER TABLE public.${tabla}
                       ADD COLUMN IF NOT EXISTS client_operation_id uuid NULL,
                       ADD COLUMN IF NOT EXISTS synced_at timestamptz NULL;`,
                    { transaction: t }
                );

                await sequelize.query(
                    `COMMENT ON COLUMN public.${tabla}.client_operation_id IS '${COMENTARIO_OP}';`,
                    { transaction: t }
                );
                await sequelize.query(
                    `COMMENT ON COLUMN public.${tabla}.synced_at IS '${COMENTARIO_SYNC}';`,
                    { transaction: t }
                );

                // ⚠️ Índice NO concurrente: `CREATE INDEX CONCURRENTLY` no puede ir dentro de una
                // transacción, y aquí no hace falta — son decenas de milisegundos sobre tablas de
                // como mucho 17.641 filas, todas con el valor NULL (o sea, fuera del índice).
                await sequelize.query(
                    `CREATE UNIQUE INDEX IF NOT EXISTS ${nombreIndice(tabla)}
                       ON public.${tabla} (client_operation_id)
                     WHERE client_operation_id IS NOT NULL;`,
                    { transaction: t }
                );
            }

            // Verificación explícita en vez de confiar: que las 6 columnas y los 3 índices existan,
            // y que NINGUNA fila histórica haya quedado con valor (deben ser todas NULL).
            for (const tabla of TABLAS) {
                const [{ columnas }] = await sequelize.query(
                    `SELECT count(*)::int AS columnas
                       FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = :tabla
                        AND column_name IN ('client_operation_id', 'synced_at')`,
                    { type: Sequelize.QueryTypes.SELECT, replacements: { tabla }, transaction: t }
                );
                if (columnas !== 2) {
                    throw new Error(`${tabla}: se esperaban 2 columnas nuevas y hay ${columnas}.`);
                }

                const [{ indices }] = await sequelize.query(
                    `SELECT count(*)::int AS indices FROM pg_indexes
                      WHERE schemaname = 'public' AND tablename = :tabla AND indexname = :indice`,
                    { type: Sequelize.QueryTypes.SELECT, transaction: t,
                      replacements: { tabla, indice: nombreIndice(tabla) } }
                );
                if (indices !== 1) {
                    throw new Error(`${tabla}: no se creó el índice ${nombreIndice(tabla)}.`);
                }

                const [{ total, con_valor }] = await sequelize.query(
                    `SELECT count(*)::int AS total,
                            count(client_operation_id)::int AS con_valor
                       FROM public.${tabla}`,
                    { type: Sequelize.QueryTypes.SELECT, transaction: t }
                );
                if (con_valor !== 0) {
                    throw new Error(`${tabla}: ${con_valor} fila(s) históricas quedaron con client_operation_id.`);
                }

                console.log(`   ✔️ ${tabla}: +client_operation_id +synced_at · ${nombreIndice(tabla)} · `
                    + `${total} fila(s) existentes intactas (todas NULL)`);
            }

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const sequelize = queryInterface.sequelize;
        const t = await sequelize.transaction();

        try {
            for (const tabla of TABLAS) {
                await sequelize.query(`DROP INDEX IF EXISTS public.${nombreIndice(tabla)};`, { transaction: t });
                await sequelize.query(
                    `ALTER TABLE public.${tabla}
                       DROP COLUMN IF EXISTS client_operation_id,
                       DROP COLUMN IF EXISTS synced_at;`,
                    { transaction: t }
                );
            }
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
};
