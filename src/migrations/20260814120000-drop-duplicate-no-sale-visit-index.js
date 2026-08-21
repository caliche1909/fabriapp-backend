'use strict';

/**
 * 🧹 Elimina un índice DUPLICADO en `store_no_sale_reports`.
 *
 * Convivían dos índices con la MISMA definición exacta sobre
 * `(visit_id) WHERE visit_id IS NOT NULL`:
 *
 *   - `idx_unique_visit_report`         → **ÚNICO**. Se CONSERVA: además de servir
 *     para las búsquedas por visita, es lo que garantiza la regla de negocio
 *     "un solo reporte de no-venta por visita".
 *   - `idx_store_no_sale_reports_visit` → no único. **Redundante**: cualquier
 *     consulta que lo usara se resuelve igual con el anterior.
 *
 * El duplicado ocupa ~136 kB y, sobre todo, obliga a una escritura extra en cada
 * alta/baja de reporte de no-venta sin aportar absolutamente nada.
 *
 * Ninguno de los dos venía de una migración: los creó el esquema inicial a partir
 * del modelo. Por eso, junto a esta migración se quita también la declaración
 * duplicada de `models/store_no_sale_reports.js`, para que el modelo refleje la
 * realidad de la base.
 *
 * Reversible: el `down` lo recrea idéntico.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            DROP INDEX IF EXISTS public.idx_store_no_sale_reports_visit;
        `);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_store_no_sale_reports_visit
                ON public.store_no_sale_reports (visit_id)
                WHERE visit_id IS NOT NULL;
        `);
    },
};
