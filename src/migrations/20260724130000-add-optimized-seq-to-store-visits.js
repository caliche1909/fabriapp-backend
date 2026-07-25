'use strict';

/**
 * Agrega `optimized_seq` a `store_visits`: el orden persistente del recorrido del día.
 *
 * - INTEGER NULL. `NULL` = "sin orden" (parada aún no optimizada, o ya visitada/completada).
 * - Lo escribe `optimizeRoute` (botón Optimizar/Recalcular): numera de forma continua las
 *   paradas PENDIENTES (abiertas optimizadas → abren más tarde → cerradas) y pone `NULL`
 *   en las no-pendientes. `getRouteDayVisits` ordena las pendientes por este campo (NULLS LAST).
 * - Aditiva y reversible; sin backfill (las visitas existentes quedan en NULL = orden alfabético).
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('store_visits', 'optimized_seq', {
            type: Sequelize.INTEGER,
            allowNull: true,
            comment: 'Orden del recorrido optimizado del día (solo paradas pendientes; NULL = sin orden)',
        });
        // Índice de apoyo para el ORDER BY por (ruta, día, usuario, orden).
        await queryInterface.addIndex('store_visits', ['route_id', 'visit_day', 'user_id', 'optimized_seq'], {
            name: 'idx_store_visits_optimized_seq',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('store_visits', 'idx_store_visits_optimized_seq');
        await queryInterface.removeColumn('store_visits', 'optimized_seq');
    },
};
