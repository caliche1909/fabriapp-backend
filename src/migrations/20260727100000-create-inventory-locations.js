'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 1/7: BODEGAS (`inventory_locations`).
 *
 * Tabla pivote del stock. Aunque la Fase A solo use la bodega CENTRAL, el stock se
 * modela por (producto, bodega) desde el día 1, así las bodegas móviles/estáticas y
 * los traspasos futuros son puramente aditivos (sin migraciones destructivas después).
 *
 * - `type`: central | estatica | movil.
 * - `is_default`: la bodega central por defecto de la compañía (única viva por compañía).
 * - `user_id`/`route_id`: enganche futuro para bodegas MÓVILES ligadas a un vendedor/ruta.
 * - Auditoría completa + soft-delete (paranoid) + trigger de `updated_at` (reusa
 *   `trigger_set_timestamp`, ya existente en la BD).
 * - SEED: crea una `Bodega Central` (is_default) por cada compañía existente.
 *
 * Aditiva y reversible. No toca nada existente.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                -- Tipo de bodega
                DO $$ BEGIN
                    CREATE TYPE public.inventory_location_type AS ENUM ('central','estatica','movil');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                CREATE TABLE public.inventory_locations (
                    id           SERIAL PRIMARY KEY,
                    company_id   UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    name         VARCHAR(100) NOT NULL,
                    type         public.inventory_location_type NOT NULL DEFAULT 'central',
                    is_default   BOOLEAN NOT NULL DEFAULT false,
                    user_id      UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    route_id     INTEGER NULL REFERENCES public.routes(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    address      TEXT NULL,
                    description  TEXT NULL,
                    is_active    BOOLEAN NOT NULL DEFAULT true,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at   TIMESTAMPTZ NULL,
                    deleted_by   UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL
                );

                CREATE INDEX idx_inventory_locations_company      ON public.inventory_locations (company_id);
                CREATE INDEX idx_inventory_locations_company_type ON public.inventory_locations (company_id, type);
                CREATE INDEX idx_inventory_locations_user         ON public.inventory_locations (user_id);
                CREATE INDEX idx_inventory_locations_route        ON public.inventory_locations (route_id);

                -- Una sola bodega por defecto (central) por compañía entre las vivas.
                CREATE UNIQUE INDEX uq_inventory_locations_one_default
                    ON public.inventory_locations (company_id)
                    WHERE is_default AND deleted_at IS NULL;

                -- Nombre de bodega único por compañía (case-insensitive) entre las vivas.
                CREATE UNIQUE INDEX uq_inventory_locations_company_name
                    ON public.inventory_locations (company_id, lower(name))
                    WHERE deleted_at IS NULL;

                -- updated_at automático
                CREATE TRIGGER set_timestamp_inventory_locations
                    BEFORE UPDATE ON public.inventory_locations
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

                -- SEED: una bodega central por compañía (companies NO es paranoid → todas).
                INSERT INTO public.inventory_locations (company_id, name, type, is_default, is_active, created_at, updated_at)
                SELECT c.id, 'Bodega Central', 'central', true, true, now(), now()
                FROM public.companies c;
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP TABLE IF EXISTS public.inventory_locations CASCADE;
                DROP TYPE IF EXISTS public.inventory_location_type;
            `, { transaction: t });
        });
    },
};
