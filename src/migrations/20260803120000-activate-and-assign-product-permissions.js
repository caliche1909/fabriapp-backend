'use strict';

/**
 * PERMISOS de PRODUCTOS y STOCK de PRODUCTOS — activación y asignación al rol ADMIN.
 *
 * Contexto (estado previo en BD):
 *   - El módulo `inventory` está activo.
 *   - Los submódulos "Productos" (code `products`) y "Stock de Productos" (`products-stock`)
 *     existen pero con is_active=false.
 *   - Los 8 permisos existen pero is_active=false y SIN asignar a ningún rol:
 *       products:        view_products, create_products, edit_products, delete_products
 *       products-stock:  view_products_stock, create_products_stock,
 *                        edit_products_stock, delete_products_stock
 *   - Los OWNERS ya funcionan (bypassan checkPermission / hasSpecificPermission). Los
 *     COLABORADORES obtienen 403 y no ven el menú hasta que estos permisos se activen y
 *     se asignen a su rol.
 *
 * Corrección importante de nomenclatura:
 *   El frontend consulta el submódulo con el código `products-list` (igual que `supplies-list`),
 *   pero en BD estaba como `products`. Sin renombrarlo, un colaborador NUNCA vería la sección
 *   de productos (hasSubmodulePermission('inventory','products-list') no lo encontraría).
 *   Por eso esta migración RENOMBRA el code `products` → `products-list` (el nombre visible
 *   "Productos" no cambia). Los permisos (view_products, etc.) NO cambian de código.
 *
 * Estrategia (espejo de la migración de ventas 20260722120000):
 *   1) Renombrar submódulo `products` → `products-list`.
 *   2) Activar submódulos `products-list` y `products-stock`.
 *   3) Activar los 8 permisos.
 *   4) Asignar los 8 permisos al rol global ADMIN (company_id NULL), idempotente.
 *      (OWNER no lo necesita —bypassa—; los roles personalizados por compañía se gestionan
 *       desde la pantalla de roles, que ahora sí verá estos permisos por estar activos.)
 *
 * Todo idempotente y por lookups de `code`/`name` (no UUIDs) → funciona igual en prod.
 * Reversible: el down restaura el estado previo (inactivos, sin asignar, code `products`).
 *
 * @type {import('sequelize-cli').Migration}
 */

const PRODUCT_PERMISSION_CODES = [
    'view_products', 'create_products', 'edit_products', 'delete_products',
    'view_products_stock', 'create_products_stock', 'edit_products_stock', 'delete_products_stock',
];

module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // 1) Renombrar el submódulo `products` → `products-list` (si aún no se hizo).
            await queryInterface.sequelize.query(
                `UPDATE submodules
                 SET code = 'products-list', updated_at = now()
                 WHERE code = 'products'
                   AND NOT EXISTS (SELECT 1 FROM submodules s2 WHERE s2.code = 'products-list');`,
                { transaction: t }
            );

            // 2) Activar los submódulos de productos.
            await queryInterface.sequelize.query(
                `UPDATE submodules
                 SET is_active = true, updated_at = now()
                 WHERE code IN ('products-list', 'products-stock');`,
                { transaction: t }
            );

            // 3) Activar los 8 permisos.
            await queryInterface.sequelize.query(
                `UPDATE permissions
                 SET is_active = true, updated_at = now()
                 WHERE code IN (:codes);`,
                { transaction: t, replacements: { codes: PRODUCT_PERMISSION_CODES } }
            );

            // 4) Asignar los 8 permisos al rol ADMIN (global, company_id NULL), idempotente.
            //    NOT EXISTS con company_id IS NULL (ON CONFLICT no deduplica con NULL en Postgres).
            await queryInterface.sequelize.query(
                `INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
                 SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
                 FROM roles r
                 JOIN permissions p ON p.code IN (:codes)
                 WHERE r.name = 'ADMIN'
                   AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                   );`,
                { transaction: t, replacements: { codes: PRODUCT_PERMISSION_CODES } }
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
            // 1) Quitar de ADMIN las asignaciones globales que creó esta migración.
            await queryInterface.sequelize.query(
                `DELETE FROM role_permissions rp
                 USING roles r, permissions p
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                   AND r.name = 'ADMIN'
                   AND p.code IN (:codes);`,
                { transaction: t, replacements: { codes: PRODUCT_PERMISSION_CODES } }
            );

            // 2) Desactivar de nuevo los 8 permisos (estado previo).
            await queryInterface.sequelize.query(
                `UPDATE permissions
                 SET is_active = false, updated_at = now()
                 WHERE code IN (:codes);`,
                { transaction: t, replacements: { codes: PRODUCT_PERMISSION_CODES } }
            );

            // 3) Desactivar de nuevo los submódulos (estado previo).
            await queryInterface.sequelize.query(
                `UPDATE submodules
                 SET is_active = false, updated_at = now()
                 WHERE code IN ('products-list', 'products-stock');`,
                { transaction: t }
            );

            // 4) Revertir el rename del submódulo `products-list` → `products`.
            await queryInterface.sequelize.query(
                `UPDATE submodules
                 SET code = 'products', updated_at = now()
                 WHERE code = 'products-list';`,
                { transaction: t }
            );

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
