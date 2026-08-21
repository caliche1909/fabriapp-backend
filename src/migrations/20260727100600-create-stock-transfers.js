'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 7/7: TRASPASOS ENTRE BODEGAS (`stock_transfers`).
 *
 * Cabecera de una transacción de inventario entre dos bodegas (p.ej. de la central a una
 * bodega móvil de un vendedor). Da un `status` con estado EN_TRANSITO, útil cuando el
 * traslado no es instantáneo (mercancía en camino).
 *
 * La ejecución (lógica futura) generará DOS patas en `product_stock_movements` por cada
 * producto trasladado: `TRASPASO_SALIDA` (origen, negativo) + `TRASPASO_ENTRADA` (destino,
 * positivo), enlazadas por `transfer_group_id` y con `reference_type='stock_transfer'` +
 * `reference_id` = id de esta cabecera, todo dentro de una transacción (si la salida deja
 * el origen en negativo, el trigger revierte todo → no hay traspaso parcial).
 *
 * `CHECK (from_location_id <> to_location_id)`. Auditoría completa + soft-delete + trigger.
 *
 * Solo estructura; la lógica de traspaso se implementa en la Fase B.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DO $$ BEGIN
                    CREATE TYPE public.stock_transfer_status AS ENUM
                        ('pendiente','en_transito','completado','cancelado');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                CREATE TABLE public.stock_transfers (
                    id                SERIAL PRIMARY KEY,
                    company_id        UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    from_location_id  INTEGER NOT NULL REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    to_location_id    INTEGER NOT NULL REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    status            public.stock_transfer_status NOT NULL DEFAULT 'pendiente',
                    transfer_group_id UUID NULL,
                    notes             TEXT NULL,
                    user_id           UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    shipped_at        TIMESTAMPTZ NULL,
                    received_at       TIMESTAMPTZ NULL,
                    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at        TIMESTAMPTZ NULL,
                    deleted_by        UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    CONSTRAINT chk_stock_transfers_distinct_locations CHECK (from_location_id <> to_location_id)
                );

                CREATE INDEX idx_stock_transfers_company ON public.stock_transfers (company_id);
                CREATE INDEX idx_stock_transfers_from    ON public.stock_transfers (from_location_id);
                CREATE INDEX idx_stock_transfers_to      ON public.stock_transfers (to_location_id);
                CREATE INDEX idx_stock_transfers_status  ON public.stock_transfers (status);
                CREATE INDEX idx_stock_transfers_group   ON public.stock_transfers (transfer_group_id)
                    WHERE transfer_group_id IS NOT NULL;

                CREATE TRIGGER set_timestamp_stock_transfers
                    BEFORE UPDATE ON public.stock_transfers
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DROP TABLE IF EXISTS public.stock_transfers CASCADE;
                DROP TYPE IF EXISTS public.stock_transfer_status;
            `, { transaction: t });
        });
    },
};
