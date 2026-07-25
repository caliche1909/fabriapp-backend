'use strict';

/**
 * FASE 1 — Migración aditiva (retrocompatible, reversible).
 *
 * Crea la tabla intermedia `routes_stores` para modelar la relación
 * MUCHOS-A-MUCHOS entre rutas y tiendas (una tienda podrá pertenecer a varias
 * rutas). Hoy la relación es 1→1 vía `stores.route_id`; esa columna se conserva
 * durante toda la transición y se elimina recién en la fase final (Fase 7).
 *
 * Incluye un BACKFILL: por cada tienda viva con `route_id`, crea su vínculo en
 * `routes_stores`. Así el nuevo modelo arranca con exactamente la misma
 * información que el actual (paridad de datos).
 *
 * NO toca ni elimina nada existente → el backend actual sigue funcionando igual
 * aunque esta migración ya esté aplicada.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.createTable('routes_stores', {
                id: {
                    type: Sequelize.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                    allowNull: false,
                },
                route_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'routes', key: 'id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                    comment: 'Ruta a la que pertenece la tienda',
                },
                store_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'stores', key: 'id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                    comment: 'Tienda vinculada a la ruta',
                },
                company_id: {
                    type: Sequelize.UUID,
                    allowNull: false,
                    references: { model: 'companies', key: 'id' },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE',
                    comment: 'Compañía dueña del vínculo (aislamiento multi-tenant)',
                },
                display_order: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    comment: 'Orden del recorrido de la tienda dentro de la ruta (opcional)',
                },
                created_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
                },
                updated_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
                },
            }, { transaction: t });

            // Una tienda no puede estar dos veces en la misma ruta.
            await queryInterface.addConstraint('routes_stores', {
                fields: ['route_id', 'store_id'],
                type: 'unique',
                name: 'uq_routes_stores_route_store',
                transaction: t,
            });

            // Índices para las consultas frecuentes.
            await queryInterface.addIndex('routes_stores', ['route_id'], {
                name: 'idx_routes_stores_route_id', transaction: t,
            });
            await queryInterface.addIndex('routes_stores', ['store_id'], {
                name: 'idx_routes_stores_store_id', transaction: t,
            });
            await queryInterface.addIndex('routes_stores', ['company_id'], {
                name: 'idx_routes_stores_company_id', transaction: t,
            });

            // BACKFILL: un vínculo por cada tienda viva con ruta viva.
            await queryInterface.sequelize.query(`
                INSERT INTO routes_stores (route_id, store_id, company_id, created_at, updated_at)
                SELECT s.route_id, s.id, s.company_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM stores s
                JOIN routes r ON r.id = s.route_id AND r.deleted_at IS NULL
                WHERE s.route_id IS NOT NULL
                  AND s.deleted_at IS NULL
                ON CONFLICT ON CONSTRAINT uq_routes_stores_route_store DO NOTHING;
            `, { transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        // Revierte por completo: elimina la tabla (y con ella el backfill). La
        // información original sigue intacta en `stores.route_id`.
        await queryInterface.dropTable('routes_stores');
    },
};
