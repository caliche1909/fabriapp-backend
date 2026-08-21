'use strict';

/**
 * MÓDULO BODEGAS — TRASPASOS v2: cabecera + ÍTEMS + recepción.
 *
 * Contexto: `stock_transfers` (cabecera) ya existía pero le faltaba lo esencial para el flujo real
 * (pendiente → en tránsito → completado, con confirmación y novedades). Esta migración:
 *
 *   1) CREA `stock_transfer_items` — el detalle de cada traspaso (1 fila por producto), con la
 *      columna `transfer_id` que enlaza cada ítem con su cabecera. Aquí vive lo que se PRETENDE
 *      mover (`quantity`) y lo que realmente se RECIBE (`received_quantity`, para faltantes),
 *      más snapshots de costo/venta/margen al emitir.
 *
 *   2) AÑADE a `stock_transfers` los campos de identificación y recepción que faltaban:
 *      - `transfer_number`  → número visible por compañía (TR-000001…), único por compañía.
 *      - `received_by`      → usuario que confirmó la recepción (auditoría de recepción).
 *      - `has_discrepancy`  → true si en la recepción hubo faltantes/novedades.
 *      - `reception_notes`  → notas de la recepción.
 *
 *   3) ELIMINA lo redundante: `stock_transfers.transfer_group_id`. El enlace cabecera ↔ patas del
 *      ledger se hace con `product_stock_movements.reference_type='stock_transfer'` +
 *      `reference_id` = id de la cabecera; el `transfer_group_id` sigue viviendo EN EL LEDGER
 *      (product_stock_movements) para agrupar las patas del traspaso. Tenerlo también en la
 *      cabecera era duplicado. (Ambas tablas están vacías: no hay datos que migrar.)
 *
 * Reversible por completo (down deshace 1/2/3).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                -- 2) Cabecera: nuevos campos de número + recepción.
                ALTER TABLE public.stock_transfers
                    ADD COLUMN transfer_number  INTEGER,
                    ADD COLUMN received_by       UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    ADD COLUMN has_discrepancy   BOOLEAN NOT NULL DEFAULT false,
                    ADD COLUMN reception_notes   TEXT NULL;

                -- Número único por compañía (el backend lo asigna secuencial por compañía al crear).
                CREATE UNIQUE INDEX uq_stock_transfers_company_number
                    ON public.stock_transfers (company_id, transfer_number);

                -- 3) Quitar el redundante de la cabecera (el enlace va por reference_id; el group_id
                --    vive en el ledger). Ambas tablas están vacías.
                ALTER TABLE public.stock_transfers
                    DROP COLUMN transfer_group_id;

                -- 1) Detalle de cada traspaso: 1 fila por producto, con transfer_id → cabecera.
                CREATE TABLE public.stock_transfer_items (
                    id                 SERIAL PRIMARY KEY,
                    company_id         UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    transfer_id        INTEGER NOT NULL REFERENCES public.stock_transfers(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id         INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    quantity           NUMERIC(14,3) NOT NULL,
                    received_quantity  NUMERIC(14,3) NULL,
                    unit_cost          NUMERIC(14,4) NULL,
                    sale_price_snapshot NUMERIC(14,2) NULL,
                    margin_snapshot    NUMERIC(6,2)  NULL,
                    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT chk_sti_quantity_positive        CHECK (quantity > 0),
                    CONSTRAINT chk_sti_received_nonnegative      CHECK (received_quantity IS NULL OR received_quantity >= 0),
                    CONSTRAINT uq_sti_transfer_product           UNIQUE (transfer_id, product_id)
                );

                CREATE INDEX idx_sti_transfer ON public.stock_transfer_items (transfer_id);
                CREATE INDEX idx_sti_company  ON public.stock_transfer_items (company_id);
                CREATE INDEX idx_sti_product  ON public.stock_transfer_items (product_id);

                CREATE TRIGGER set_timestamp_stock_transfer_items
                    BEFORE UPDATE ON public.stock_transfer_items
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                -- 1) Detalle.
                DROP TABLE IF EXISTS public.stock_transfer_items CASCADE;

                -- 3) Restaurar el redundante en la cabecera.
                ALTER TABLE public.stock_transfers
                    ADD COLUMN transfer_group_id UUID NULL;
                CREATE INDEX idx_stock_transfers_group ON public.stock_transfers (transfer_group_id)
                    WHERE transfer_group_id IS NOT NULL;

                -- 2) Quitar los campos nuevos de la cabecera.
                DROP INDEX IF EXISTS public.uq_stock_transfers_company_number;
                ALTER TABLE public.stock_transfers
                    DROP COLUMN IF EXISTS transfer_number,
                    DROP COLUMN IF EXISTS received_by,
                    DROP COLUMN IF EXISTS has_discrepancy,
                    DROP COLUMN IF EXISTS reception_notes;
            `, { transaction: t });
        });
    },
};
