'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 2/7: CATEGORÍAS (`product_categories`).
 *
 * Catálogo plano (sin jerarquía) para agrupar/filtrar productos y, a futuro, reportes
 * por categoría. Tenant-scoped. Categoría OPCIONAL en el producto (FK nullable).
 * Auditoría completa + soft-delete + trigger de `updated_at`.
 *
 * Aditiva y reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                CREATE TABLE public.product_categories (
                    id           SERIAL PRIMARY KEY,
                    company_id   UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    name         VARCHAR(100) NOT NULL,
                    description  TEXT NULL,
                    is_active    BOOLEAN NOT NULL DEFAULT true,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at   TIMESTAMPTZ NULL,
                    deleted_by   UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_product_categories_company ON public.product_categories (company_id);

                -- Nombre único por compañía (case-insensitive) entre las vivas.
                CREATE UNIQUE INDEX uq_product_categories_company_name
                    ON public.product_categories (company_id, lower(name))
                    WHERE deleted_at IS NULL;

                CREATE TRIGGER set_timestamp_product_categories
                    BEFORE UPDATE ON public.product_categories
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(`DROP TABLE IF EXISTS public.product_categories CASCADE;`);
    },
};
