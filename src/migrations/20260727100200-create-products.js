'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 3/7: CATÁLOGO (`products`).
 *
 * Productos terminados que la empresa VENDE (productos simples, sin variantes: cada
 * presentación es su propio producto/SKU). Tenant-scoped (con `company_id`, que el
 * modelo legacy NO tenía). NO guarda cantidad aquí: el stock vive en las tablas de
 * balance/movimientos por (producto, bodega).
 *
 * - `production_cost`: costo unitario CALCULADO desde la receta (cache; se recalcula al
 *   cambiar la receta). `sale_price`: precio de venta.
 * - `min_stock`: punto de reorden (alerta de stock bajo).
 * - `unit_id`: unidad de venta (reusa el catálogo global `measurement_units`).
 * - `sku`/`barcode` opcionales; SKU único por compañía entre los vivos.
 * - Auditoría completa + soft-delete + trigger de `updated_at`.
 *
 * NOTA: reemplaza conceptualmente al modelo legacy `products.js` (que apunta a
 * `work_areas` inexistente). El modelo Sequelize se reconstruirá en la fase de código.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                CREATE TABLE public.products (
                    id               SERIAL PRIMARY KEY,
                    company_id       UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    category_id      INTEGER NULL REFERENCES public.product_categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    unit_id          INTEGER NULL REFERENCES public.measurement_units(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    name             VARCHAR(100) NOT NULL,
                    sku              VARCHAR(50) NULL,
                    barcode          VARCHAR(50) NULL,
                    description      TEXT NULL,
                    sale_price       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
                    production_cost  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (production_cost >= 0),
                    min_stock        NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
                    is_active        BOOLEAN NOT NULL DEFAULT true,
                    image_url        TEXT NULL,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at       TIMESTAMPTZ NULL,
                    deleted_by       UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_products_company        ON public.products (company_id);
                CREATE INDEX idx_products_company_active ON public.products (company_id, is_active);
                CREATE INDEX idx_products_category       ON public.products (category_id);
                CREATE INDEX idx_products_unit           ON public.products (unit_id);
                CREATE INDEX idx_products_company_name   ON public.products (company_id, lower(name));

                -- SKU único por compañía entre los vivos (ignora NULL).
                CREATE UNIQUE INDEX uq_products_company_sku
                    ON public.products (company_id, sku)
                    WHERE sku IS NOT NULL AND deleted_at IS NULL;

                CREATE TRIGGER set_timestamp_products
                    BEFORE UPDATE ON public.products
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(`DROP TABLE IF EXISTS public.products CASCADE;`);
    },
};
