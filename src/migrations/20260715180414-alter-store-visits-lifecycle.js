'use strict';

/**
 * FASE 1 — Migración aditiva (retrocompatible, reversible).
 *
 * Convierte `store_visits` de "evento de visita real" a "parada con ciclo de
 * vida" (pending → visited → completed), preparando el flujo de "Iniciar ruta".
 *
 * Cambios sobre `store_visits`:
 *   - `status`     VARCHAR(20) NOT NULL DEFAULT 'pending'  (+ CHECK).
 *   - `visit_day`  DATE (día hábil del negocio, TZ America/Bogota).
 *   - `arrived_at` TIMESTAMPTZ (momento en que se marcó 'visited').
 *   - `distance`   pasa a NULLABLE (una parada 'pending' aún no tiene distancia).
 *   - UNIQUE(store_id, route_id, user_id, visit_day) → idempotencia diaria.
 *
 * BACKFILL de las filas existentes (todas son visitas reales del pasado):
 *   - status    = 'completed' si sale_amount > 0, si no 'visited'.
 *   - visit_day = (date AT TIME ZONE 'America/Bogota')::date.
 *   - arrived_at = date (mejor aproximación histórica de la llegada).
 *
 * NO elimina columnas ni datos → el backend actual sigue funcionando igual.
 * Verificado en dev antes de correr en prod: 0 duplicados que violen el UNIQUE.
 *
 * @type {import('sequelize-cli').Migration}
 */
const TZ = 'America/Bogota';

module.exports = {
    async up(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // 1) Nuevas columnas (aditivas).
            await queryInterface.addColumn('store_visits', 'status', {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'pending',
                comment: "Ciclo de vida de la parada: 'pending' | 'visited' | 'completed'",
            }, { transaction: t });

            await queryInterface.addColumn('store_visits', 'visit_day', {
                type: Sequelize.DATEONLY,
                allowNull: true,
                comment: 'Día hábil del negocio (TZ America/Bogota) al que pertenece la parada',
            }, { transaction: t });

            await queryInterface.addColumn('store_visits', 'arrived_at', {
                type: Sequelize.DATE, // TIMESTAMPTZ en Postgres
                allowNull: true,
                comment: "Momento en que la parada pasó a 'visited' (llegada real)",
            }, { transaction: t });

            // 2) `distance` pasa a NULLABLE (una parada 'pending' aún no la tiene).
            await queryInterface.sequelize.query(
                'ALTER TABLE store_visits ALTER COLUMN distance DROP NOT NULL;',
                { transaction: t }
            );

            // 3) BACKFILL de las filas existentes (todas visitas reales).
            await queryInterface.sequelize.query(`
                UPDATE store_visits
                SET status     = CASE WHEN sale_amount > 0 THEN 'completed' ELSE 'visited' END,
                    visit_day  = (date AT TIME ZONE '${TZ}')::date,
                    arrived_at = date
                WHERE visit_day IS NULL;
            `, { transaction: t });

            // 4) CHECK de valores válidos para status (paridad con el CHECK que tenía stores).
            await queryInterface.sequelize.query(`
                ALTER TABLE store_visits
                ADD CONSTRAINT store_visits_status_check
                CHECK (status IN ('pending', 'visited', 'completed'));
            `, { transaction: t });

            // 5) UNIQUE diario: una parada por (tienda, ruta, vendedor, día).
            //    (Los NULL en route_id/visit_day se tratan como distintos → no molestan.)
            await queryInterface.addConstraint('store_visits', {
                fields: ['store_id', 'route_id', 'user_id', 'visit_day'],
                type: 'unique',
                name: 'uq_store_visits_daily',
                transaction: t,
            });

            // 6) Índices de apoyo para las consultas del día.
            await queryInterface.addIndex('store_visits', ['visit_day'], {
                name: 'idx_store_visits_visit_day', transaction: t,
            });
            await queryInterface.addIndex('store_visits', ['route_id', 'visit_day', 'status'], {
                name: 'idx_store_visits_route_day_status', transaction: t,
            });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.removeIndex('store_visits', 'idx_store_visits_route_day_status', { transaction: t });
            await queryInterface.removeIndex('store_visits', 'idx_store_visits_visit_day', { transaction: t });
            await queryInterface.removeConstraint('store_visits', 'uq_store_visits_daily', { transaction: t });
            await queryInterface.sequelize.query(
                'ALTER TABLE store_visits DROP CONSTRAINT IF EXISTS store_visits_status_check;',
                { transaction: t }
            );

            // Restaurar distance NOT NULL: primero eliminar posibles nulos introducidos.
            await queryInterface.sequelize.query(
                'UPDATE store_visits SET distance = 0 WHERE distance IS NULL;',
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                'ALTER TABLE store_visits ALTER COLUMN distance SET NOT NULL;',
                { transaction: t }
            );

            await queryInterface.removeColumn('store_visits', 'arrived_at', { transaction: t });
            await queryInterface.removeColumn('store_visits', 'visit_day', { transaction: t });
            await queryInterface.removeColumn('store_visits', 'status', { transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
