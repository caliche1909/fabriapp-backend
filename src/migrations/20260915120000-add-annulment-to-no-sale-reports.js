'use strict';

/**
 * 🚫 Anular un reporte de no compra — el tendero que dice que no y al rato compra.
 *
 * EL CASO. El vendedor llega, el tendero no le compra, reporta la no compra. Al rato el tendero
 * lo llama, el vendedor vuelve y sí le vende. Hoy esa venta **no se rechaza: se guarda apartada**
 * (`sales.conflict_reason`, §11) y no cuenta en ningún informe.
 *
 * Medido sobre producción el 2026-09-15: las **4** ventas apartadas de todo el histórico son
 * exactamente este caso, las 4 **con señal** —ninguna es un conflicto de sincronización—, una de
 * ellas por 56.000 el mismo día, y otra registrada **dos veces** porque el vendedor reintentó al
 * no entender qué había pasado.
 *
 * 🔴 POR QUÉ SE MARCA Y NO SE BORRA. Borrar habría sido más barato: cero migraciones y ninguna de
 * las 9 consultas que leen esta tabla habría que tocarla. Se marca igualmente porque:
 *
 *   1. Con el borrado hay una pregunta que **no se puede responder nunca**: ante una parada
 *      visitada, sin venta y sin motivo, nadie sabría si hubo un reporte que se anuló o si nunca
 *      se hizo ninguno.
 *   2. Los informes de no compra por categoría y motivo **cambiarían hacia atrás, en silencio**.
 *      Y sin señal la anulación llega horas después, así que el número se movería bajo los pies
 *      del supervisor mucho después del hecho.
 *   3. Es el grano del resto del sistema: las ventas que no caben se apartan, las operaciones
 *      rechazadas se marcan. Un borrado disparado por un vendedor desde la calle sería la única
 *      pieza que rompe esa regla.
 *
 * 🔴 EL ÍNDICE ÚNICO SE VUELVE PARCIAL, Y NO ES OPCIONAL. `idx_unique_visit_report` garantiza "un
 * solo reporte por visita". Sin añadirle `AND annulled_at IS NULL`, la tienda que se arrepiente
 * **otra vez** —el tendero llama, el vendedor vuelve, y al final no le compra— dejaría al vendedor
 * sin poder volver a reportar la no compra. La regla que se quiere es "un solo reporte VIVO por
 * visita", que no es lo mismo.
 *
 * `annulled_operation_id` es la idempotencia de la anulación, igual que `client_operation_id` lo
 * es del alta: la cola reintenta cuando se pierde la respuesta, y sin esto el reintento no podría
 * reconocer su propio trabajo.
 *
 * Coste: tres columnas anulables son **solo metadatos** en PostgreSQL (no reescriben filas). El
 * índice sí se reconstruye, sobre 5.989 filas: instantáneo.
 *
 * Diseño completo en `OFFLINE-CAMPO.md` §14.
 *
 * @type {import('sequelize-cli').Migration}
 */

const COMENTARIOS = {
    annulled_at: 'Cuándo se anuló este reporte para poder registrar la venta. '
        + 'NULL = reporte vivo. Ver OFFLINE-CAMPO.md §14.',
    annulled_by: 'Quién lo anuló. Es el rastro que el borrado no dejaría.',
    annulled_operation_id: 'client_operation_id de la anulación: idempotencia de la cola offline.',
};

module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.store_no_sale_reports
                    ADD COLUMN IF NOT EXISTS annulled_at timestamptz NULL,
                    ADD COLUMN IF NOT EXISTS annulled_by uuid NULL REFERENCES public.users(id),
                    ADD COLUMN IF NOT EXISTS annulled_operation_id uuid NULL;
            `, { transaction: t });

            for (const [columna, comentario] of Object.entries(COMENTARIOS)) {
                await queryInterface.sequelize.query(
                    `COMMENT ON COLUMN public.store_no_sale_reports.${columna} IS '${comentario}';`,
                    { transaction: t }
                );
            }

            // "Un solo reporte VIVO por visita". El DDL de PostgreSQL es transaccional, así que
            // entre el DROP y el CREATE no queda ninguna ventana en la que la regla no aplique.
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.idx_unique_visit_report;
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX idx_unique_visit_report
                    ON public.store_no_sale_reports (visit_id)
                    WHERE visit_id IS NOT NULL AND annulled_at IS NULL;
            `, { transaction: t });

            // Idempotencia de la anulación, con la misma forma que la del alta.
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS uq_store_no_sale_reports_annulled_operation_id
                    ON public.store_no_sale_reports (annulled_operation_id)
                    WHERE annulled_operation_id IS NOT NULL;
            `, { transaction: t });

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    /**
     * ⚠️ REVERSIBLE SOLO MIENTRAS NADIE HAYA VUELTO A REPORTAR SOBRE UNA VISITA YA ANULADA.
     *
     * El `down` restaura el índice ESTRICTO (un reporte por visita, anulado o no). Si para alguna
     * visita existen un reporte anulado y otro nuevo —que es justo lo que el índice parcial viene
     * a permitir— la creación del índice **falla**, y la migración se queda sin revertir.
     *
     * Es deliberado: la alternativa sería borrar filas para que quepa, y perder datos en un `down`
     * es peor que no poder revertir. Para saber si estorba algo, antes de revertir:
     *
     *     SELECT visit_id, count(*) FROM public.store_no_sale_reports
     *      WHERE visit_id IS NOT NULL GROUP BY visit_id HAVING count(*) > 1;
     *
     * Las tres columnas sí se van sin problema: solo se pierde el rastro de las anulaciones.
     */
    async down(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.uq_store_no_sale_reports_annulled_operation_id;
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.idx_unique_visit_report;
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX idx_unique_visit_report
                    ON public.store_no_sale_reports (visit_id)
                    WHERE visit_id IS NOT NULL;
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                ALTER TABLE public.store_no_sale_reports
                    DROP COLUMN IF EXISTS annulled_operation_id,
                    DROP COLUMN IF EXISTS annulled_by,
                    DROP COLUMN IF EXISTS annulled_at;
            `, { transaction: t });
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
};
