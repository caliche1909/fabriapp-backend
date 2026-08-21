'use strict';

/**
 * TRASPASOS — Permiso `resolve_transfer_discrepancy` ("Resolver novedad de traspaso").
 *
 * 1) Crea y ACTIVA el permiso en el submódulo `warehouse-transfers` (idempotente por code).
 * 2) Lo asigna al rol global ADMIN (company_id NULL), espejo de los otros permisos de traspasos.
 *    OWNER bypassa; los roles personalizados por compañía lo verán en la pantalla de roles por estar activo.
 *
 * Autoriza a marcar una novedad (faltante/sobrante) como CUADRADA. En el controlador la autorización es:
 * owner · o con este permiso · o responsable de la bodega origen/destino del traspaso.
 *
 * Idempotente y reversible. La compañía nunca entra aquí (permiso global).
 *
 * @type {import('sequelize-cli').Migration}
 */

const PERMISSION_CODE = 'resolve_transfer_discrepancy';

module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            // 1) Crear + activar el permiso en el submódulo de Traspasos.
            await q(`
                INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
                SELECT uuid_generate_v4(), 'Resolver novedad de traspaso', '${PERMISSION_CODE}', s.id,
                       'Permite marcar una novedad de traspaso (faltante/sobrante) como cuadrada', true, now(), now()
                FROM submodules s
                WHERE s.code = 'warehouse-transfers'
                  AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = '${PERMISSION_CODE}');
            `);

            // 2) Asignar al rol ADMIN (global, company_id NULL), idempotente.
            await q(`
                INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
                SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
                FROM roles r
                JOIN permissions p ON p.code = '${PERMISSION_CODE}'
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
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            await q(`
                DELETE FROM role_permissions rp
                USING roles r, permissions p
                WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.company_id IS NULL
                  AND r.name = 'ADMIN' AND p.code = '${PERMISSION_CODE}';
            `);
            await q(`DELETE FROM permissions WHERE code = '${PERMISSION_CODE}';`);

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
