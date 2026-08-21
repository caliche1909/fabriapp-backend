'use strict';

/**
 * BODEGAS — Permisos + submódulo de Traspasos.
 *
 * 1) Renombra el submódulo de bodegas: code `routes` → `warehouses` (el name ya era "Bodegas")
 *    y lo ACTIVA. Con esto el frontend consulta `hasSubmodulePermission('inventory','warehouses')`.
 * 2) Crea el submódulo `warehouse-transfers` ("Traspasos"), activo (página propia).
 * 3) Crea y ACTIVA los permisos:
 *      warehouses:          view_warehouses, create_warehouses, edit_warehouses, delete_warehouses
 *      warehouse-transfers: view_transfers, create_transfer, receive_transfer, cancel_transfer
 *    `view_warehouses` es el que necesita un colaborador (no owner) para ver TODAS las bodegas
 *    (el endpoint /api/warehouses/list ya lo comprueba).
 * 4) Asigna los 8 permisos al rol global ADMIN (company_id NULL), espejo de productos/insumos.
 *    (OWNER bypassa; los roles personalizados por compañía se gestionan desde la pantalla de roles,
 *     que ahora verá estos permisos por estar activos.)
 *
 * Idempotente (lookups por code) y reversible. La compañía nunca entra aquí (permisos globales).
 *
 * @type {import('sequelize-cli').Migration}
 */

const WAREHOUSE_PERMISSION_CODES = [
    'view_warehouses', 'create_warehouses', 'edit_warehouses', 'delete_warehouses',
    'view_transfers', 'create_transfer', 'receive_transfer', 'cancel_transfer',
];

module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            // 1) Renombrar `routes` → `warehouses` (si aún no) y activarlo.
            await q(`
                UPDATE submodules
                SET code = 'warehouses', is_active = true, updated_at = now()
                WHERE code = 'routes'
                  AND module_id = (SELECT id FROM modules WHERE code = 'inventory')
                  AND NOT EXISTS (SELECT 1 FROM submodules s2 WHERE s2.code = 'warehouses');
            `);
            await q(`
                UPDATE submodules
                SET is_active = true, updated_at = now()
                WHERE code = 'warehouses'
                  AND module_id = (SELECT id FROM modules WHERE code = 'inventory');
            `);

            // 2) Crear el submódulo de Traspasos.
            await q(`
                INSERT INTO submodules (id, module_id, name, code, description, route_path, is_active, created_at, updated_at)
                SELECT uuid_generate_v4(), m.id, 'Traspasos', 'warehouse-transfers',
                       'Traspasos de inventario entre bodegas', '/warehouses/transfers', true, now(), now()
                FROM modules m
                WHERE m.code = 'inventory'
                  AND NOT EXISTS (SELECT 1 FROM submodules s WHERE s.code = 'warehouse-transfers');
            `);

            // 3) Crear + activar los permisos de ambos submódulos.
            await q(`
                INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
                SELECT uuid_generate_v4(), v.name, v.code, s.id, v.description, true, now(), now()
                FROM submodules s
                CROSS JOIN (VALUES
                    ('Ver bodegas',        'view_warehouses',   'warehouses',          'Permite ver todas las bodegas de la compañía'),
                    ('Crear bodegas',      'create_warehouses', 'warehouses',          'Permite crear bodegas'),
                    ('Editar bodegas',     'edit_warehouses',   'warehouses',          'Permite editar bodegas (incl. abrir/cerrar y responsable)'),
                    ('Eliminar bodegas',   'delete_warehouses', 'warehouses',          'Permite eliminar bodegas'),
                    ('Ver traspasos',      'view_transfers',    'warehouse-transfers', 'Permite ver los traspasos'),
                    ('Crear traspaso',     'create_transfer',   'warehouse-transfers', 'Permite emitir traspasos'),
                    ('Recibir traspaso',   'receive_transfer',  'warehouse-transfers', 'Permite confirmar la recepción de traspasos'),
                    ('Cancelar traspaso',  'cancel_transfer',   'warehouse-transfers', 'Permite cancelar/devolver traspasos')
                ) AS v(name, code, submodule_code, description)
                WHERE s.code = v.submodule_code
                  AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);
            `);

            // 4) Asignar los 8 permisos al rol ADMIN (global, company_id NULL), idempotente.
            await q(`
                INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
                SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
                FROM roles r
                JOIN permissions p ON p.code IN (
                    'view_warehouses','create_warehouses','edit_warehouses','delete_warehouses',
                    'view_transfers','create_transfer','receive_transfer','cancel_transfer'
                )
                WHERE r.name = 'ADMIN'
                  AND NOT EXISTS (
                    SELECT 1 FROM role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                  );
            `);

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            const codes = WAREHOUSE_PERMISSION_CODES.map((c) => `'${c}'`).join(',');
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            // Reverso: quitar asignaciones de ADMIN → borrar permisos → borrar submódulo transfers →
            // desactivar y renombrar warehouses → routes.
            await q(`
                DELETE FROM role_permissions rp
                USING roles r, permissions p
                WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                  AND r.name = 'ADMIN' AND p.code IN (${codes});
            `);
            await q(`DELETE FROM permissions WHERE code IN (${codes});`);
            await q(`DELETE FROM submodules WHERE code = 'warehouse-transfers';`);
            await q(`
                UPDATE submodules
                SET code = 'routes', is_active = false, updated_at = now()
                WHERE code = 'warehouses'
                  AND module_id = (SELECT id FROM modules WHERE code = 'inventory');
            `);

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
