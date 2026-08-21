'use strict';

/**
 * INVENTARIO — Repurpose del submódulo "Rutas" a "Bodegas".
 *
 * El submódulo de inventario con code `routes` (hoy inactivo, "Rutas") se reutiliza como
 * el módulo de BODEGAS (gestión de bodegas y traspasos de inventario). Esta migración solo
 * ajusta el NOMBRE visible y el route_path; NO cambia el `code` ni el is_active:
 *   - name:       'Rutas'    → 'Bodegas'
 *   - route_path: '/routes'  → '/warehouses'
 *
 * El `code` sigue siendo `routes` a propósito: es el identificador de permiso, y su
 * renombrado/activación/asignación a roles se hará en una migración de permisos dedicada
 * (igual que se hizo con productos), cuando se construya la funcionalidad de bodegas.
 *
 * Idempotente (lookup por code) y reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            `UPDATE submodules
             SET name = 'Bodegas', route_path = '/warehouses', updated_at = now()
             WHERE code = 'routes'
               AND module_id = (SELECT id FROM modules WHERE code = 'inventory');`
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            `UPDATE submodules
             SET name = 'Rutas', route_path = '/routes', updated_at = now()
             WHERE code = 'routes'
               AND module_id = (SELECT id FROM modules WHERE code = 'inventory');`
        );
    },
};
