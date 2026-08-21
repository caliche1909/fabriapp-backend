'use strict';

/**
 * FIX (corrección hacia adelante) del trigger `apply_product_stock_movement`.
 *
 * BUG introducido en `20260810120100-fix-product-stock-trigger-atomic`: se hacía
 *   INSERT ... VALUES (balance = NEW.quantity_change)
 *   ON CONFLICT (product_id, location_id) DO UPDATE SET balance = balance + NEW.quantity_change
 * Para una fila EXISTENTE con delta NEGATIVO (toda SALIDA/venta), Postgres evalúa el
 * CHECK (balance >= 0) sobre la fila PROPUESTA del INSERT (p.ej. -3) ANTES de resolver el
 * ON CONFLICT → lanzaba check_violation (23514) por error, rompiendo cualquier salida sobre un
 * saldo existente. (El caso positivo y el primer-movimiento-negativo sí funcionaban, por eso no
 * se detectó antes.)
 *
 * FIX correcto y atómico (mantiene la protección anti lost-update):
 *   1) INSERT ... VALUES (balance = 0) ON CONFLICT DO NOTHING → asegura que la fila exista sin
 *      lost-update (dos INSERT concurrentes: uno inserta, el otro no hace nada; ambos ven la fila).
 *      Insertar 0 SIEMPRE pasa el CHECK.
 *   2) UPDATE ... SET balance = balance + NEW.quantity_change → suma atómica con lock de fila
 *      sobre el saldo ya commiteado. El CHECK (balance >= 0) rechaza (23514) si quedaría negativo,
 *      tanto en fila nueva (0 + negativo) como existente.
 *
 * Reversible: `down` restaura la versión anterior (la atómica con el bug del ON CONFLICT).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            CREATE OR REPLACE FUNCTION public.apply_product_stock_movement()
            RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                -- 1) Asegurar la fila de saldo (0 si no existía), sin lost-update.
                INSERT INTO public.product_stock_balances
                    (company_id, product_id, location_id, balance, last_updated, created_at, updated_at)
                VALUES
                    (NEW.company_id, NEW.product_id, NEW.location_id, 0, now(), now(), now())
                ON CONFLICT (product_id, location_id) DO NOTHING;

                -- 2) Sumar el delta ATÓMICAMENTE (lock de fila). El CHECK (balance >= 0) rechaza el negativo.
                UPDATE public.product_stock_balances
                SET balance = balance + NEW.quantity_change,
                    last_updated = now()
                WHERE product_id = NEW.product_id AND location_id = NEW.location_id;

                RETURN NEW;
            END;
            $fn$;
        `);
    },

    async down(queryInterface) {
        // Restaura la versión anterior (atómica con el bug de orden del ON CONFLICT / CHECK).
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
};
