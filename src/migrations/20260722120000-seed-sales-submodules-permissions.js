'use strict';

/**
 * Siembra los submódulos y permisos de VISTA (solo lectura) del módulo de ventas
 * para que coincidan con las 6 vistas reales del frontend, y los asigna al rol ADMIN.
 *
 * Contexto: el módulo `sales` ya existe, pero sus submódulos en BD estaban
 * desactualizados respecto al frontend, que hoy tiene 6 vistas:
 *   Dashboard · Cuadre · Análisis y Reportes · Historial · No-Venta · Configuración.
 *
 * Estrategia:
 *   - REUTILIZAR lo que ya calza: submódulo `reports` (perm `view_reports`) para
 *     "Análisis y Reportes", y `sales-history` (perm `view_sales_history`) para "Historial".
 *   - CREAR 4 submódulos nuevos + su permiso `view`:
 *       sales-dashboard        -> view_sales_dashboard
 *       sales-reconciliation   -> view_sales_reconciliation
 *       sales-no-sale          -> view_no_sale_reports
 *       sales-configuration    -> view_sales_configuration
 *   - NO se toca el submódulo `new-sale` (POS, feature aparte).
 *   - ASIGNAR al rol ADMIN (global, company_id NULL) los 6 permisos de vista
 *     (los 4 nuevos + view_reports + view_sales_history), porque ADMIN hoy no tiene
 *     ningún permiso de ventas y perdería el módulo al gatear.
 *
 * Todo es idempotente (WHERE NOT EXISTS): se puede correr más de una vez sin duplicar.
 * Se usan lookups por `code`/`name` (no UUIDs) para que funcione igual en prod.
 */
module.exports = {
  async up(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      // 1) Submódulos nuevos bajo el módulo `sales`.
      await queryInterface.sequelize.query(
        `INSERT INTO submodules (id, module_id, name, code, description, route_path, is_active, created_at, updated_at)
         SELECT uuid_generate_v4(), m.id, v.name, v.code, v.description, v.route_path, true, now(), now()
         FROM modules m
         CROSS JOIN (VALUES
           ('Dashboard',              'sales-dashboard',      'Vista de dashboard de ventas (solo lectura)',       '/dashboard'),
           ('Cuadre de Ventas',       'sales-reconciliation', 'Vista de cuadre de ventas (solo lectura)',          '/cuadre'),
           ('Reportes de No-Venta',   'sales-no-sale',        'Vista de reportes de no-venta (solo lectura)',      '/no-sale'),
           ('Configuración',          'sales-configuration',  'Vista de configuración de ventas (solo lectura)',   '/configuration')
         ) AS v(name, code, description, route_path)
         WHERE m.code = 'sales'
           AND NOT EXISTS (SELECT 1 FROM submodules s WHERE s.code = v.code);`,
        { transaction: t }
      );

      // 2) Permiso de vista por cada submódulo nuevo.
      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
         SELECT uuid_generate_v4(), v.name, v.code, s.id, v.description, true, now(), now()
         FROM submodules s
         CROSS JOIN (VALUES
           ('Ver dashboard de ventas',    'view_sales_dashboard',      'sales-dashboard',      'Permite ver el dashboard de ventas'),
           ('Ver cuadre de ventas',       'view_sales_reconciliation', 'sales-reconciliation', 'Permite ver el cuadre de ventas'),
           ('Ver reportes de no-venta',   'view_no_sale_reports',      'sales-no-sale',        'Permite ver los reportes de no-venta'),
           ('Ver configuración de ventas','view_sales_configuration',  'sales-configuration',  'Permite ver la configuración de ventas')
         ) AS v(name, code, submodule_code, description)
         WHERE s.code = v.submodule_code
           AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code);`,
        { transaction: t }
      );

      // 3) Asignar al rol ADMIN los 6 permisos de vista (company_id NULL = global).
      //    NOT EXISTS con company_id IS NULL para idempotencia (el ON CONFLICT no
      //    deduplica cuando company_id es NULL en Postgres).
      await queryInterface.sequelize.query(
        `INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
         SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
         FROM roles r
         JOIN permissions p ON p.code IN (
           'view_sales_dashboard', 'view_sales_reconciliation',
           'view_no_sale_reports', 'view_sales_configuration',
           'view_reports', 'view_sales_history'
         )
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
      // 1) Quitar de ADMIN las asignaciones que creó esta migración (los 6 permisos de
      //    vista; ADMIN no tenía ninguno de ventas antes, así que se retiran todos).
      await queryInterface.sequelize.query(
        `DELETE FROM role_permissions rp
         USING roles r, permissions p
         WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
           AND r.name = 'ADMIN'
           AND p.code IN (
             'view_sales_dashboard', 'view_sales_reconciliation',
             'view_no_sale_reports', 'view_sales_configuration',
             'view_reports', 'view_sales_history'
           );`,
        { transaction: t }
      );

      // 2) Borrar los 4 permisos nuevos (NO se tocan view_reports / view_sales_history,
      //    que ya existían y solo se reutilizaron).
      await queryInterface.sequelize.query(
        `DELETE FROM permissions
         WHERE code IN (
           'view_sales_dashboard', 'view_sales_reconciliation',
           'view_no_sale_reports', 'view_sales_configuration'
         );`,
        { transaction: t }
      );

      // 3) Borrar los 4 submódulos nuevos.
      await queryInterface.sequelize.query(
        `DELETE FROM submodules
         WHERE code IN (
           'sales-dashboard', 'sales-reconciliation',
           'sales-no-sale', 'sales-configuration'
         );`,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
