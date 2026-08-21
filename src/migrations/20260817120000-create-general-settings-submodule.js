'use strict';

/**
 * ⚙️ Submódulo "Configuraciones" (module `settings`) + sus 2 permisos, asignados al rol ADMIN.
 *
 * Es la página donde el dueño decide CÓMO opera su compañía. Nace con un solo ajuste
 * (modo de ventas e inventarios, ver `20260817120100`), pero el submódulo es el contenedor
 * de los que vengan después (impuestos, numeración, etc.), por eso el nombre genérico.
 *
 * Se llama `general-settings` para no chocar con:
 *   - `company-settings`  → "Mi compañía" (datos fiscales, logo, ubicación).
 *   - `sales-configuration` → configuración DEL MÓDULO de ventas (métodos de pago, motivos).
 *
 * Permisos: `view_general_settings` (ver) y `manage_general_settings` (guardar cambios).
 * El OWNER no los necesita (bypassa `checkPermission`); se asignan a ADMIN (global,
 * company_id NULL) igual que el resto de submódulos, o ADMIN perdería la página al gatearla.
 *
 * Todo idempotente (WHERE NOT EXISTS) y por `code`/`name`, nunca por UUID, para que corra
 * igual en dev y en producción.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // 1) Submódulo bajo el módulo `settings`, ACTIVO desde el nacimiento.
            await queryInterface.sequelize.query(
                `INSERT INTO submodules (id, module_id, name, code, description, route_path, is_active, created_at, updated_at)
                 SELECT uuid_generate_v4(), m.id, 'Configuraciones', 'general-settings',
                        'Ajustes de operación de la compañía (modo de ventas e inventarios, etc.)',
                        '/generalSettings', true, now(), now()
                 FROM modules m
                 WHERE m.code = 'settings'
                   AND NOT EXISTS (SELECT 1 FROM submodules s WHERE s.code = 'general-settings');`,
                { transaction: t }
            );

            // 2) Los 2 permisos del submódulo.
            await queryInterface.sequelize.query(
                `INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
                 SELECT uuid_generate_v4(), v.name, v.code, s.id, v.description, true, now(), now()
                 FROM submodules s
                 CROSS JOIN (VALUES
                   ('Ver configuraciones',      'view_general_settings',   'Permite ver las configuraciones de la compañía'),
                   ('Gestionar configuraciones','manage_general_settings', 'Permite modificar y guardar las configuraciones de la compañía')
                 ) AS v(name, code, description)
                 WHERE s.code = 'general-settings'
                   AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);`,
                { transaction: t }
            );

            // 3) Asignarlos al rol ADMIN (global). NOT EXISTS con company_id IS NULL:
            //    en Postgres un ON CONFLICT no deduplica cuando la columna es NULL.
            await queryInterface.sequelize.query(
                `INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
                 SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
                 FROM roles r
                 JOIN permissions p ON p.code IN ('view_general_settings', 'manage_general_settings')
                 WHERE r.name = 'ADMIN'
                   AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                   );`,
                { transaction: t }
            );

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },

    async down(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // El orden importa: primero las asignaciones (FK), luego permisos, luego el submódulo.
            await queryInterface.sequelize.query(
                `DELETE FROM role_permissions rp
                 USING permissions p
                 WHERE rp.permission_id = p.id
                   AND p.code IN ('view_general_settings', 'manage_general_settings');`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `DELETE FROM permissions WHERE code IN ('view_general_settings', 'manage_general_settings');`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `DELETE FROM submodules WHERE code = 'general-settings';`,
                { transaction: t }
            );

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
