'use strict';

/**
 * STOCK de PRODUCTOS — Snapshot de PRECIOS por movimiento.
 *
 * Cada movimiento (ENTRADA/SALIDA/AJUSTE...) debe congelar los precios que tenía el
 * producto en ESE instante, para que el histórico sea fiel aunque el producto cambie
 * de costo/precio después. El servidor los estampa desde el producto (nunca del cliente):
 *
 *  - unit_cost           → snapshot del COSTO de producción (columna ya existente; ahora
 *                          se llena en TODO movimiento, no solo en ENTRADA).
 *  - sale_price_snapshot → snapshot del PRECIO DE VENTA del producto.
 *  - margin_snapshot     → snapshot del MARGEN (%) = round((venta - costo) / venta * 100),
 *                          NULL si no hay venta o costo (misma regla que la tabla de productos).
 *
 * Aditiva y reversible. No toca unit_cost (solo agrega las dos columnas nuevas).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.product_stock_movements
                    ADD COLUMN IF NOT EXISTS sale_price_snapshot NUMERIC(14,2) NULL,
                    ADD COLUMN IF NOT EXISTS margin_snapshot NUMERIC(6,2) NULL;

                COMMENT ON COLUMN public.product_stock_movements.sale_price_snapshot
                    IS 'Snapshot del precio de venta del producto al momento del movimiento';
                COMMENT ON COLUMN public.product_stock_movements.margin_snapshot
                    IS 'Snapshot del margen (%) al momento del movimiento; NULL si no hay costo o venta';
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.product_stock_movements
                    DROP COLUMN IF EXISTS sale_price_snapshot,
                    DROP COLUMN IF EXISTS margin_snapshot;
            `, { transaction: t });
        });
    },
};
