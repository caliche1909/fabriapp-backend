'use strict';

/**
 * FIX de concurrencia — trigger de saldo de PRODUCTOS (`apply_product_stock_movement`).
 *
 * PROBLEMA (lost-update en el PRIMER movimiento de una bodega no central): la versión original
 * hacía `SELECT ... FOR UPDATE` (que NO bloquea una fila inexistente) y luego
 * `INSERT ... ON CONFLICT DO UPDATE SET balance = EXCLUDED.balance` (valor absoluto precalculado).
 * Con dos incrementos concurrentes sobre un (producto, bodega) SIN fila previa, ambos calculaban
 * v_current = 0 y el segundo sobrescribía al primero (se perdía su +delta). En la bodega central
 * no ocurre porque la fila siempre existe (se siembra al crear el producto), pero sí es alcanzable
 * en bodegas no centrales vía ajustes/traspasos.
 *
 * FIX: UPSERT ATÓMICO donde el DO UPDATE SUMA el delta al saldo ya commiteado de la fila
 * (`product_stock_balances.balance + delta`), tomando lock de fila → sin lost-update incluso en la
 * primera escritura concurrente. El guardián anti-negativo sigue siendo el CHECK (balance >= 0)
 * (SQLSTATE 23514) — se dispara tanto en el INSERT (fila nueva con delta negativo) como en el
 * UPDATE — que el controlador mapea a 409.
 *
 * Solo reemplaza el CUERPO de la función; el trigger `tr_apply_product_stock_movement` no se toca.
 * Reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            CREATE OR REPLACE FUNCTION public.apply_product_stock_movement()
            RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                INSERT INTO public.product_stock_balances
                    (company_id, product_id, location_id, balance, last_updated, created_at, updated_at)
                VALUES
                    (NEW.company_id, NEW.product_id, NEW.location_id, NEW.quantity_change, now(), now(), now())
                ON CONFLICT (product_id, location_id) DO UPDATE
                    SET balance = public.product_stock_balances.balance + NEW.quantity_change,
                        last_updated = now();

                RETURN NEW;
            END;
            $fn$;
        `);
    },

    async down(queryInterface) {
        // Restaura EXACTAMENTE la versión original (SELECT FOR UPDATE + SET = EXCLUDED.balance).
        await queryInterface.sequelize.query(`
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
        `);
    },
};
