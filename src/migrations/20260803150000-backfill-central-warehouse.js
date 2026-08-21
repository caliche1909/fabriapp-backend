'use strict';

/**
 * BODEGAS — Backfill de la bodega central para compañías que no la tengan.
 *
 * Toda compañía necesita su bodega `central` (is_default=true) como pivote del stock de
 * productos. Las compañías existentes ya la tienen (sembrada al construir el stock), y las
 * nuevas la reciben en el registro (register_company_and_user_controller). Esta migración es
 * una RED DE SEGURIDAD idempotente: crea la central solo para compañías que no tengan una viva.
 *
 * `down` es no-op a propósito: no se eliminan bodegas automáticamente porque pueden haber
 * acumulado stock/movimientos.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            INSERT INTO inventory_locations
                (company_id, name, type, status, is_default, is_active, created_at, updated_at)
            SELECT c.id, 'Bodega Central', 'central', 'abierta', true, true, now(), now()
            FROM companies c
            WHERE NOT EXISTS (
                SELECT 1 FROM inventory_locations il
                WHERE il.company_id = c.id AND il.is_default = true AND il.deleted_at IS NULL
            );
        `);
    },

    async down() {
        // No-op: no se eliminan bodegas centrales automáticamente (podrían tener stock/movimientos).
    },
};
