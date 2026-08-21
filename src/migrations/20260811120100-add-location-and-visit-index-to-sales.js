'use strict';

/**
 * MÓDULO VENTAS — ajustes a `sales` para el punto de venta con inventario.
 *
 *   1) `location_id` → la BODEGA desde la que se vendió (la bodega móvil del vendedor). Con el modelo
 *      nuevo, cada venta descuenta el stock de una bodega concreta; guardar cuál da trazabilidad y
 *      habilita reportes por bodega. Nullable (las ventas viejas no la tienen). FK RESTRICT para
 *      preservar la referencia (las bodegas se soft-borran; RESTRICT solo afecta a un borrado físico,
 *      ya bloqueado por las guardas del CRUD de bodegas). Igual criterio que product_stock_movements.
 *
 *   2) Índice parcial sobre `visit_id` (activas, no nulas): consultar/sumar las ventas de una visita
 *      (con "varias ventas por visita" habilitado) sin escaneo secuencial. `sales` no tenía índice
 *      sobre `visit_id`.
 *
 * NO cambia lógica de negocio (el candado "una venta por visita" se retira en el código, no aquí).
 * Reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.sales
                    ADD COLUMN location_id INTEGER NULL
                        REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;

                -- Reportes / consultas de ventas por bodega (solo activas, patrón de los demás índices).
                CREATE INDEX idx_sales_active_by_location
                    ON public.sales (location_id)
                    WHERE deleted_at IS NULL;

                -- Ventas de una visita (varias ventas por visita): lookup/suma sin seq scan.
                CREATE INDEX idx_sales_active_by_visit
                    ON public.sales (visit_id)
                    WHERE deleted_at IS NULL AND visit_id IS NOT NULL;
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.idx_sales_active_by_visit;
                DROP INDEX IF EXISTS public.idx_sales_active_by_location;
                ALTER TABLE public.sales DROP COLUMN IF EXISTS location_id;
            `, { transaction: t });
        });
    },
};
