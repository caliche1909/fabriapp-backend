'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 5/7: RECETAS (`recipes`, `recipe_items`).
 *
 * Cada producto puede tener una receta que define qué INSUMOS consume y en qué cantidad,
 * para calcular su COSTO DE PRODUCCIÓN (que se cachea en `products.production_cost`).
 *
 * - `recipes`: cabecera. `yield_quantity` = unidades producidas por lote. Una receta
 *   ACTIVA por producto (índice único parcial). Tenant-scoped.
 * - `recipe_items`: líneas. Cada línea consume un `inventory_supplies` (corrige la FK
 *   rota del modelo legacy, que apuntaba a una tabla `supplies` inexistente). `unit_id`
 *   reusa `measurement_units`. `supply_id` con ON DELETE RESTRICT: no se puede borrar un
 *   insumo que está en una receta (protege la integridad del costeo).
 * - Auditoría completa + soft-delete + trigger de `updated_at` en ambas.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                CREATE TABLE public.recipes (
                    id             SERIAL PRIMARY KEY,
                    company_id     UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id     INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    name           VARCHAR(100) NULL,
                    yield_quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
                    preparation    TEXT NULL,
                    notes          TEXT NULL,
                    is_active      BOOLEAN NOT NULL DEFAULT true,
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at     TIMESTAMPTZ NULL,
                    deleted_by     UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_recipes_company ON public.recipes (company_id);
                CREATE INDEX idx_recipes_product ON public.recipes (product_id);

                -- Una sola receta ACTIVA por producto entre las vivas.
                CREATE UNIQUE INDEX uq_recipes_one_active_per_product
                    ON public.recipes (product_id)
                    WHERE is_active AND deleted_at IS NULL;

                CREATE TRIGGER set_timestamp_recipes
                    BEFORE UPDATE ON public.recipes
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

                CREATE TABLE public.recipe_items (
                    id          SERIAL PRIMARY KEY,
                    recipe_id   INTEGER NOT NULL REFERENCES public.recipes(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    supply_id   INTEGER NOT NULL REFERENCES public.inventory_supplies(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
                    unit_id     INTEGER NULL REFERENCES public.measurement_units(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    notes       TEXT NULL,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at  TIMESTAMPTZ NULL,
                    deleted_by  UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_recipe_items_recipe ON public.recipe_items (recipe_id);
                CREATE INDEX idx_recipe_items_supply ON public.recipe_items (supply_id);

                -- Un insumo no se repite dentro de la misma receta (entre las líneas vivas).
                CREATE UNIQUE INDEX uq_recipe_items_recipe_supply
                    ON public.recipe_items (recipe_id, supply_id)
                    WHERE deleted_at IS NULL;

                CREATE TRIGGER set_timestamp_recipe_items
                    BEFORE UPDATE ON public.recipe_items
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP TABLE IF EXISTS public.recipe_items CASCADE;
                DROP TABLE IF EXISTS public.recipes CASCADE;
            `, { transaction: t });
        });
    },
};
