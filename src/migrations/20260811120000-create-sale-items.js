'use strict';

/**
 * MÓDULO VENTAS — crear `sale_items` (el DETALLE de cada venta).
 *
 * Contexto: la tabla `sales` (cabecera) ya existía, pero `sale_items` solo estaba MODELADA
 * (server/src/models/sale_items.js) y NUNCA se creó en la BD. El punto de venta con lista de
 * productos necesita esta tabla para guardar 1 fila por producto vendido.
 *
 * Diseño (ledger INMUTABLE: 1 fila por producto; solo `created_at`, sin updated_at ni soft-delete
 * — si una venta se corrige, se anula/rehace, no se editan sus líneas):
 *   - `sale_id`     → cabecera; ON DELETE CASCADE (los ítems mueren con la venta).
 *   - `company_id`  → denormalizado (reportes tenant-scoped sin join), como en el ledger de stock.
 *   - `product_id`  → producto vendido; RESTRICT (no se borra un producto con ventas).
 *   - `product_name`→ SNAPSHOT del nombre al vender (recibo histórico aunque luego se renombre/borre).
 *   - `quantity`    → NUMERIC(14,3), CHECK > 0.
 *   - `unit_price`  → SNAPSHOT del precio de venta al momento (NUMERIC(14,2), CHECK >= 0).
 *   - `unit_cost`   → SNAPSHOT del costo de producción al momento (NUMERIC(14,4), NULL si el producto
 *                     no tiene costo). Con unit_price + unit_cost el MARGEN por línea queda congelado.
 *   - `total_price` → = quantity × unit_price (NUMERIC(14,2), CHECK >= 0).
 *   - UNIQUE (sale_id, product_id): 1 línea por producto en cada venta (el POS agrega cantidades).
 *
 * NO crea aún `sales.location_id` ni sus índices: eso va en la migración B.
 * Reversible por completo.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                CREATE TABLE public.sale_items (
                    id            SERIAL PRIMARY KEY,
                    sale_id       INTEGER NOT NULL REFERENCES public.sales(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    company_id    UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id    INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    product_name  TEXT NOT NULL,
                    quantity      NUMERIC(14,3) NOT NULL,
                    unit_price    NUMERIC(14,2) NOT NULL,
                    unit_cost     NUMERIC(14,4) NULL,
                    total_price   NUMERIC(14,2) NOT NULL,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT chk_si_quantity_positive   CHECK (quantity > 0),
                    CONSTRAINT chk_si_unit_price_nonneg    CHECK (unit_price >= 0),
                    CONSTRAINT chk_si_unit_cost_nonneg     CHECK (unit_cost IS NULL OR unit_cost >= 0),
                    CONSTRAINT chk_si_total_price_nonneg   CHECK (total_price >= 0),
                    CONSTRAINT uq_si_sale_product           UNIQUE (sale_id, product_id)
                );

                CREATE INDEX idx_si_sale    ON public.sale_items (sale_id);
                CREATE INDEX idx_si_company ON public.sale_items (company_id);
                CREATE INDEX idx_si_product ON public.sale_items (product_id);
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP TABLE IF EXISTS public.sale_items CASCADE;
            `, { transaction: t });
        });
    },
};
