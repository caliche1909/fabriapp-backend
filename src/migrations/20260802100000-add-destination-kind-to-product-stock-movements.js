'use strict';

/**
 * STOCK de PRODUCTOS — Salidas con "destino" forward-compatible.
 *
 * Agrega `destination_kind` (enum) a `product_stock_movements`. Se llena SOLO en SALIDA
 * y describe a dónde/por qué salió el producto de la bodega central:
 *  - BODEGA_MOVIL  → futura bodega móvil (vehículo de reparto)
 *  - PUNTO_VENTA   → futuro punto de venta propio (bodega estática)
 *  - DISTRIBUIDOR  → distribuidor autorizado (otra compañía)
 *  - MERMA         → daño/pérdida de producto que YA estaba en central
 *  - OTRO          → cualquier otro motivo
 *
 * Hoy es una etiqueta/intención (la salida descuenta central). Cuando existan bodegas
 * reales, la salida a una bodega se volverá TRASPASO de 2 patas (aditivo, sin migrar esto).
 *
 * Aditiva y reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DO $$ BEGIN
                    CREATE TYPE public.product_stock_destination_kind AS ENUM
                        ('BODEGA_MOVIL','PUNTO_VENTA','DISTRIBUIDOR','MERMA','OTRO');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                ALTER TABLE public.product_stock_movements
                    ADD COLUMN IF NOT EXISTS destination_kind public.product_stock_destination_kind NULL;
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.product_stock_movements DROP COLUMN IF EXISTS destination_kind;
                DROP TYPE IF EXISTS public.product_stock_destination_kind;
            `, { transaction: t });
        });
    },
};
