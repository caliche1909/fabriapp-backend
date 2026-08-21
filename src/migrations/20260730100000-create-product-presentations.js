'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Catálogo de PRESENTACIONES por compañía.
 *
 * Etiqueta de la forma en que se vende un producto simple ("Unidad", "Paq x8",
 * "Paca x12x5"). Es un catálogo LIGERO por compañía (NO tiene factor de conversión:
 * los productos son simples, cada presentación es su propio producto). Se llena con
 * "creación al vuelo" desde el formulario de producto (Autocomplete freeSolo).
 *
 * Además, en `products` se REEMPLAZA `unit_id` (→ measurement_units, catálogo global
 * compartido con insumos/recetas/producción) por `presentation_id` (→ product_presentations).
 * `measurement_units` NO se toca (la usan otros módulos).
 *
 * Aditiva y reversible: `down` recrea `unit_id` y elimina `presentation_id` + la tabla.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            // 1) Catálogo de presentaciones por compañía (mismo patrón que product_categories).
            await queryInterface.sequelize.query(`
                CREATE TABLE public.product_presentations (
                    id           SERIAL PRIMARY KEY,
                    company_id   UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    name         VARCHAR(60) NOT NULL,
                    is_active    BOOLEAN NOT NULL DEFAULT true,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at   TIMESTAMPTZ NULL,
                    deleted_by   UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_product_presentations_company ON public.product_presentations (company_id);

                -- Nombre único por compañía (case-insensitive) entre las vivas.
                CREATE UNIQUE INDEX uq_product_presentations_company_name
                    ON public.product_presentations (company_id, lower(name))
                    WHERE deleted_at IS NULL;

                CREATE TRIGGER set_timestamp_product_presentations
                    BEFORE UPDATE ON public.product_presentations
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });

            // 2) products: quitar unit_id (y su índice) y agregar presentation_id.
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.idx_products_unit;
                ALTER TABLE public.products DROP COLUMN IF EXISTS unit_id;

                ALTER TABLE public.products
                    ADD COLUMN presentation_id INTEGER NULL
                    REFERENCES public.product_presentations(id) ON UPDATE CASCADE ON DELETE SET NULL;

                CREATE INDEX idx_products_presentation ON public.products (presentation_id);
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            // Revertir products: quitar presentation_id y recrear unit_id (nullable, como estaba).
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS public.idx_products_presentation;
                ALTER TABLE public.products DROP COLUMN IF EXISTS presentation_id;

                ALTER TABLE public.products
                    ADD COLUMN unit_id INTEGER NULL
                    REFERENCES public.measurement_units(id) ON UPDATE CASCADE ON DELETE RESTRICT;

                CREATE INDEX idx_products_unit ON public.products (unit_id);
            `, { transaction: t });

            await queryInterface.sequelize.query(
                `DROP TABLE IF EXISTS public.product_presentations CASCADE;`,
                { transaction: t }
            );
        });
    },
};
