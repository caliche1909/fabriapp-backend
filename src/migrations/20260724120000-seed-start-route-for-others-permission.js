'use strict';

/**
 * Siembra el permiso `start_route_for_others` bajo el submódulo `routes-management`
 * del módulo `delivery`, y lo asigna por defecto al rol ADMIN.
 *
 * Contexto: el flujo de "Iniciar ruta" crea las visitas del día a nombre de un
 * usuario (el que las va a resolver). Por regla de negocio:
 *   - El OWNER puede iniciar una ruta para cualquier usuario de la empresa.
 *   - Un COLABORADOR solo puede iniciar para otro usuario si tiene ESTE permiso;
 *     de lo contrario solo puede iniciar SU propia ruta (siendo el vendedor
 *     asignado y en un día hábil).
 *
 * El owner no necesita el permiso (bypass total). Se asigna a ADMIN por defecto
 * como rol gerencial; cada empresa puede reasignarlo desde la gestión de roles.
 *
 * Idempotente (WHERE NOT EXISTS): se puede correr más de una vez sin duplicar.
 * Lookups por `code`/`name` (no UUIDs) para que funcione igual en prod.
 */
module.exports = {
  async up(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      // 1) Permiso nuevo bajo el submódulo routes-management.
      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
         SELECT uuid_generate_v4(),
                'Iniciar ruta para otro usuario',
                'start_route_for_others',
                s.id,
                'Permite iniciar una ruta a nombre de otro usuario de la empresa',
                true, now(), now()
         FROM submodules s
         WHERE s.code = 'routes-management'
           AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = 'start_route_for_others');`,
        { transaction: t }
      );

      // 2) Asignar al rol ADMIN (company_id NULL = global). NOT EXISTS con
      //    company_id IS NULL para idempotencia (ON CONFLICT no deduplica NULLs).
      await queryInterface.sequelize.query(
        `INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
         SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
         FROM roles r
         JOIN permissions p ON p.code = 'start_route_for_others'
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
      // 1) Quitar la asignación a ADMIN.
      await queryInterface.sequelize.query(
        `DELETE FROM role_permissions rp
         USING roles r, permissions p
         WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
           AND r.name = 'ADMIN'
           AND p.code = 'start_route_for_others';`,
        { transaction: t }
      );

      // 2) Borrar el permiso.
      await queryInterface.sequelize.query(
        `DELETE FROM permissions WHERE code = 'start_route_for_others';`,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
