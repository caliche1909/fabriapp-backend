'use strict';

/**
 * TRASPASOS — Rastreo de RESOLUCIÓN de novedades (v2 "a prueba de olvidos").
 *
 * Agrega a `stock_transfers` 4 columnas para saber si una novedad (faltante/sobrante detectado en la
 * recepción, `has_discrepancy = true`) YA fue cuadrada con un AJUSTE en la bodega correspondiente:
 *   - discrepancy_resolved         BOOLEAN NOT NULL DEFAULT false → true cuando se marca como cuadrada.
 *   - discrepancy_resolved_by      UUID (FK users, SET NULL)      → quién la cuadró (auditoría).
 *   - discrepancy_resolved_at      TIMESTAMPTZ                    → cuándo se cuadró.
 *   - discrepancy_resolution_notes TEXT                           → cómo se cuadró (opcional).
 *
 * Las novedades existentes quedan `false` (= "sin resolver"), que es lo correcto. Reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.addColumn('stock_transfers', 'discrepancy_resolved', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: 'true si la novedad (faltante/sobrante) ya fue cuadrada con un ajuste',
            }, { transaction: t });

            await queryInterface.addColumn('stock_transfers', 'discrepancy_resolved_by', {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
                comment: 'Usuario que marcó la novedad como cuadrada (auditoría)',
            }, { transaction: t });

            await queryInterface.addColumn('stock_transfers', 'discrepancy_resolved_at', {
                type: Sequelize.DATE,
                allowNull: true,
                comment: 'Momento en que se marcó la novedad como cuadrada',
            }, { transaction: t });

            await queryInterface.addColumn('stock_transfers', 'discrepancy_resolution_notes', {
                type: Sequelize.TEXT,
                allowNull: true,
                comment: 'Nota de cómo se cuadró la novedad (opcional)',
            }, { transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.removeColumn('stock_transfers', 'discrepancy_resolution_notes', { transaction: t });
            await queryInterface.removeColumn('stock_transfers', 'discrepancy_resolved_at', { transaction: t });
            await queryInterface.removeColumn('stock_transfers', 'discrepancy_resolved_by', { transaction: t });
            await queryInterface.removeColumn('stock_transfers', 'discrepancy_resolved', { transaction: t });
            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
