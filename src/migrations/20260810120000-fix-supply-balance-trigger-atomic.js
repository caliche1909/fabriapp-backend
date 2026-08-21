'use strict';

/**
 * FIX de concurrencia — trigger de saldo de INSUMOS (`update_supply_balance`).
 *
 * PROBLEMA (lost-update / sobreventa): la versión original calculaba el nuevo saldo con un
 * `SELECT balance + delta` SIN bloqueo y luego escribía un VALOR ABSOLUTO precalculado
 * (`UPDATE ... SET balance = new_balance`). Dos movimientos concurrentes sobre el mismo insumo
 * leían el mismo saldo, ambos pasaban la validación y el segundo pisaba al primero → se perdía
 * una resta (sobreventa). El CHECK (balance >= 0) de la tabla NO lo atrapa porque cada valor
 * calculado por separado es >= 0.
 *
 * FIX: actualización ATÓMICA `SET balance = balance + delta`. La suma en SQL toma lock de fila,
 * así que las salidas/entradas concurrentes se serializan y cada una suma sobre el saldo ya
 * commiteado. El guardián anti-negativo pasa a ser el CHECK `check_balance_not_negative`
 * (SQLSTATE 23514), que el controlador `insertSuppliesStock` mapea a un 409 amigable.
 *
 * Solo reemplaza el CUERPO de la función (CREATE OR REPLACE); el trigger
 * `tr_update_supply_balance` sobre `supplies_stock` no se toca. Reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            CREATE OR REPLACE FUNCTION public.update_supply_balance()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            BEGIN
                -- Atómico: 'balance = balance + delta' serializa por lock de fila (sin lost-update).
                -- El CHECK (balance >= 0) rechaza (23514) si una SALIDA dejaría el saldo negativo.
                UPDATE public.inventory_supplies_balance
                SET balance = balance + NEW.quantity_change_gr_ml_und,
                    last_updated = CURRENT_TIMESTAMP
                WHERE inventory_supply_id = NEW.inventory_supply_id;

                RETURN NEW;
            END;
            $function$;
        `);
    },

    async down(queryInterface) {
        // Restaura EXACTAMENTE la versión original (precálculo + RAISE, no atómica).
        await queryInterface.sequelize.query(`
            CREATE OR REPLACE FUNCTION public.update_supply_balance()
            RETURNS trigger LANGUAGE plpgsql AS $function$
            DECLARE
                new_balance DECIMAL(10,2);
            BEGIN
                SELECT balance + NEW.quantity_change_gr_ml_und
                INTO new_balance
                FROM inventory_supplies_balance
                WHERE inventory_supply_id = NEW.inventory_supply_id;

                IF new_balance < 0 THEN
                    RAISE EXCEPTION 'No hay suficiente stock disponible. Balance quedaría en: %', new_balance;
                END IF;

                UPDATE inventory_supplies_balance
                SET
                    balance = new_balance,
                    last_updated = CURRENT_TIMESTAMP
                WHERE inventory_supply_id = NEW.inventory_supply_id;

                RETURN NEW;
            END;
            $function$;
        `);
    },
};
