'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 6/7: PRODUCCIÓN
 * (`production_orders`, `production_consumptions`).
 *
 * Registra QUÉ SE PRODUCE CADA DÍA y a qué costo real.
 *
 * - `production_orders`: una orden/lote de producción de un producto en una fecha, hacia
 *   una bodega (normalmente la central). `status` (planificada→en_proceso→completada).
 *   Al completar (lógica futura), consumirá insumos (movimientos de `supplies_stock`
 *   negativos) y producirá stock del producto (movimiento `PRODUCCION` positivo), y
 *   calculará `unit_cost`/`total_cost`. `production_date` para "qué se produjo hoy".
 * - `production_consumptions`: SNAPSHOT de los insumos realmente consumidos por la orden
 *   con su `unit_cost` al momento (los costos de insumo cambian) → costeo real trazable.
 * - Auditoría completa + soft-delete + trigger de `updated_at`.
 *
 * Solo estructura; la lógica de ejecución se implementa en una fase posterior.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DO $$ BEGIN
                    CREATE TYPE public.production_order_status AS ENUM
                        ('planificada','en_proceso','completada','cancelada');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                CREATE TABLE public.production_orders (
                    id                SERIAL PRIMARY KEY,
                    company_id        UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id        INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    recipe_id         INTEGER NULL REFERENCES public.recipes(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    location_id       INTEGER NOT NULL REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    quantity_produced NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_produced >= 0),
                    production_date   DATE NOT NULL DEFAULT CURRENT_DATE,
                    status            public.production_order_status NOT NULL DEFAULT 'planificada',
                    unit_cost         NUMERIC(14,4) NULL CHECK (unit_cost IS NULL OR unit_cost >= 0),
                    total_cost        NUMERIC(14,2) NULL CHECK (total_cost IS NULL OR total_cost >= 0),
                    notes             TEXT NULL,
                    user_id           UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    completed_at      TIMESTAMPTZ NULL,
                    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at        TIMESTAMPTZ NULL,
                    deleted_by        UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_production_orders_company      ON public.production_orders (company_id);
                CREATE INDEX idx_production_orders_company_date ON public.production_orders (company_id, production_date);
                CREATE INDEX idx_production_orders_product      ON public.production_orders (product_id);
                CREATE INDEX idx_production_orders_status       ON public.production_orders (status);
                CREATE INDEX idx_production_orders_location     ON public.production_orders (location_id);

                CREATE TRIGGER set_timestamp_production_orders
                    BEFORE UPDATE ON public.production_orders
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

                CREATE TABLE public.production_consumptions (
                    id                  SERIAL PRIMARY KEY,
                    production_order_id INTEGER NOT NULL REFERENCES public.production_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    supply_id           INTEGER NOT NULL REFERENCES public.inventory_supplies(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
                    unit_id             INTEGER NULL REFERENCES public.measurement_units(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    unit_cost           NUMERIC(14,4) NULL CHECK (unit_cost IS NULL OR unit_cost >= 0),
                    total_cost          NUMERIC(14,2) NULL CHECK (total_cost IS NULL OR total_cost >= 0),
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at          TIMESTAMPTZ NULL,
                    deleted_by          UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_production_consumptions_order  ON public.production_consumptions (production_order_id);
                CREATE INDEX idx_production_consumptions_supply ON public.production_consumptions (supply_id);

                CREATE TRIGGER set_timestamp_production_consumptions
                    BEFORE UPDATE ON public.production_consumptions
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP TABLE IF EXISTS public.production_consumptions CASCADE;
                DROP TABLE IF EXISTS public.production_orders CASCADE;
                DROP TYPE IF EXISTS public.production_order_status;
            `, { transaction: t });
        });
    },
};
