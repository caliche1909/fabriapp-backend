'use strict';

/**
 * MÓDULO INVENTARIO DE PRODUCTOS — Migración 4/7: STOCK (balances + ledger + triggers).
 *
 * Mismo patrón que insumos (snapshot mantenido por trigger + ledger append-only con
 * delta con signo), pero MEJORADO:
 *  - El stock se lleva por (producto, BODEGA) → soporta multi-bodega desde ya.
 *  - El ledger `product_stock_movements` SÍ tiene `company_id` (el de insumos no lo tenía).
 *  - `unit_cost` en cada ENTRADA/PRODUCCION → habilita valorización / costo promedio a futuro.
 *
 * Tablas:
 *  - `product_stock_balances`: snapshot 1 fila por (producto, bodega). `balance >= 0`.
 *    Escrito SOLO por trigger. Es un DERIVADO → NO lleva soft-delete (su vida está atada
 *    al producto/bodega vía CASCADE); solo created_at/updated_at.
 *  - `product_stock_movements`: ledger INMUTABLE append-only. La auditoría ES el propio
 *    registro (created_at + user_id) → NO lleva updated_at ni soft-delete. Los errores se
 *    corrigen con un movimiento de REVERSA/AJUSTE, nunca borrando/editando historia.
 *
 * Triggers:
 *  - `tr_apply_product_stock_movement` (AFTER INSERT en movements): UPSERT del balance
 *    sumando el delta con signo; RECHAZA si el balance quedaría < 0.
 *  - `tr_create_product_central_balance` (AFTER INSERT en products): siembra balance 0 en
 *    la bodega central de la compañía (así el producto nuevo aparece en el stock central).
 *
 * El signo del `quantity_change` manda (el enum es descriptivo/auditoría):
 *  ENTRADA/PRODUCCION/TRASPASO_ENTRADA → positivo; SALIDA/TRASPASO_SALIDA → negativo;
 *  AJUSTE → con signo (positivo o negativo).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DO $$ BEGIN
                    CREATE TYPE public.product_stock_movement_type AS ENUM
                        ('ENTRADA','SALIDA','AJUSTE','TRASPASO_SALIDA','TRASPASO_ENTRADA','PRODUCCION');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                -- ===== SNAPSHOT (derivado; sin soft-delete) =====
                CREATE TABLE public.product_stock_balances (
                    id           SERIAL PRIMARY KEY,
                    company_id   UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id   INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    location_id  INTEGER NOT NULL REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    balance      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (balance >= 0),
                    last_updated TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE UNIQUE INDEX uq_product_stock_balances_product_location
                    ON public.product_stock_balances (product_id, location_id);
                CREATE INDEX idx_product_stock_balances_company          ON public.product_stock_balances (company_id);
                CREATE INDEX idx_product_stock_balances_company_location ON public.product_stock_balances (company_id, location_id);
                CREATE INDEX idx_product_stock_balances_location         ON public.product_stock_balances (location_id);

                CREATE TRIGGER set_timestamp_product_stock_balances
                    BEFORE UPDATE ON public.product_stock_balances
                    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

                -- ===== LEDGER (inmutable append-only; sin updated_at ni soft-delete) =====
                CREATE TABLE public.product_stock_movements (
                    id                SERIAL PRIMARY KEY,
                    company_id        UUID NOT NULL REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    product_id        INTEGER NOT NULL REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    location_id       INTEGER NOT NULL REFERENCES public.inventory_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    quantity_change   NUMERIC(14,3) NOT NULL,
                    movement_type     public.product_stock_movement_type NOT NULL,
                    transfer_group_id UUID NULL,
                    unit_cost         NUMERIC(14,4) NULL CHECK (unit_cost IS NULL OR unit_cost >= 0),
                    reference_type    VARCHAR(40) NULL,
                    reference_id      INTEGER NULL,
                    description       TEXT NULL,
                    user_id           UUID NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
                    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX idx_psm_company          ON public.product_stock_movements (company_id);
                CREATE INDEX idx_psm_product          ON public.product_stock_movements (product_id);
                CREATE INDEX idx_psm_location         ON public.product_stock_movements (location_id);
                CREATE INDEX idx_psm_product_location ON public.product_stock_movements (product_id, location_id);
                CREATE INDEX idx_psm_type             ON public.product_stock_movements (movement_type);
                CREATE INDEX idx_psm_created_at       ON public.product_stock_movements (created_at);
                CREATE INDEX idx_psm_reference        ON public.product_stock_movements (reference_type, reference_id);
                CREATE INDEX idx_psm_transfer_group   ON public.product_stock_movements (transfer_group_id)
                    WHERE transfer_group_id IS NOT NULL;

                -- ===== TRIGGER: aplicar movimiento al balance (UPSERT + guarda no-negativo) =====
                CREATE OR REPLACE FUNCTION public.apply_product_stock_movement()
                RETURNS trigger LANGUAGE plpgsql AS $fn$
                DECLARE
                    v_current NUMERIC(14,3);
                    v_new     NUMERIC(14,3);
                BEGIN
                    SELECT balance INTO v_current
                    FROM public.product_stock_balances
                    WHERE product_id = NEW.product_id AND location_id = NEW.location_id
                    FOR UPDATE;

                    IF NOT FOUND THEN
                        v_current := 0;
                    END IF;

                    v_new := v_current + NEW.quantity_change;

                    IF v_new < 0 THEN
                        RAISE EXCEPTION
                            'Stock insuficiente: el producto % en la bodega % quedaría en % (disponible %).',
                            NEW.product_id, NEW.location_id, v_new, v_current
                            USING ERRCODE = 'check_violation';
                    END IF;

                    INSERT INTO public.product_stock_balances
                        (company_id, product_id, location_id, balance, last_updated, created_at, updated_at)
                    VALUES
                        (NEW.company_id, NEW.product_id, NEW.location_id, v_new, now(), now(), now())
                    ON CONFLICT (product_id, location_id) DO UPDATE
                        SET balance = EXCLUDED.balance,
                            last_updated = now();

                    RETURN NEW;
                END;
                $fn$;

                CREATE TRIGGER tr_apply_product_stock_movement
                    AFTER INSERT ON public.product_stock_movements
                    FOR EACH ROW EXECUTE FUNCTION public.apply_product_stock_movement();

                -- ===== TRIGGER: crear balance 0 en la bodega central al crear un producto =====
                CREATE OR REPLACE FUNCTION public.create_product_central_balance()
                RETURNS trigger LANGUAGE plpgsql AS $fn$
                DECLARE
                    v_central INTEGER;
                BEGIN
                    SELECT id INTO v_central
                    FROM public.inventory_locations
                    WHERE company_id = NEW.company_id AND is_default = true AND deleted_at IS NULL
                    ORDER BY id
                    LIMIT 1;

                    IF v_central IS NOT NULL THEN
                        INSERT INTO public.product_stock_balances
                            (company_id, product_id, location_id, balance, last_updated, created_at, updated_at)
                        VALUES
                            (NEW.company_id, NEW.id, v_central, 0, now(), now(), now())
                        ON CONFLICT (product_id, location_id) DO NOTHING;
                    END IF;

                    RETURN NEW;
                END;
                $fn$;

                CREATE TRIGGER tr_create_product_central_balance
                    AFTER INSERT ON public.products
                    FOR EACH ROW EXECUTE FUNCTION public.create_product_central_balance();
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                -- El trigger sobre products debe soltarse aquí (products se elimina en su propia migración 3).
                DROP TRIGGER IF EXISTS tr_create_product_central_balance ON public.products;
                DROP FUNCTION IF EXISTS public.create_product_central_balance();
                DROP FUNCTION IF EXISTS public.apply_product_stock_movement();
                DROP TABLE IF EXISTS public.product_stock_movements CASCADE;
                DROP TABLE IF EXISTS public.product_stock_balances CASCADE;
                DROP TYPE IF EXISTS public.product_stock_movement_type;
            `, { transaction: t });
        });
    },
};
