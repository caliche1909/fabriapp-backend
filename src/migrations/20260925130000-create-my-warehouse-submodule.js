'use strict';

/**
 * 🚚 Submódulo "Mis bodegas" (module `delivery`) + su permiso, asignado al rol global SELLER.
 *
 * 🔴 POR QUÉ VIVE EN RUTAS DE REPARTO Y NO EN INVENTARIOS. Dos razones:
 *
 *  1. **Es donde el vendedor trabaja.** Su jornada entera pasa en rutas; mandarlo a INVENTARIOS
 *     —un módulo de quien administra la fábrica— a mirar su propio camión es un salto de contexto
 *     sin motivo.
 *  2. **El nombre dice la verdad.** En INVENTARIOS el submódulo se llama "Bodegas", y su listado
 *     ya se acota solo a las del responsable cuando NO se tiene `view_warehouses`. Un vendedor
 *     vería una lista titulada "Bodegas" con un solo elemento, **sin forma de saber si esas son
 *     todas o solo la suya**. "Mi bodega" no deja lugar a dudas.
 *
 * Y hay una tercera razón, técnica: el único permiso de "ver" del submódulo Bodegas es
 * `view_warehouses`, que en `getWarehouses` significa literalmente **"ver TODAS"**. Dárselo al
 * vendedor para que le aparezca el menú le abriría la central y los camiones de sus compañeros —
 * exactamente lo contrario de lo que se busca. Aquí el permiso nace ya con el alcance correcto.
 *
 * El permiso es **solo de lectura**: `view_own_warehouse`. Recibir traspasos y cuadrar novedades
 * NO necesitan permiso — los controladores ya autorizan al ENCARGADO de la bodega (ver
 * `receiveTransfer` y `resolveDiscrepancy`). Ajustar, en cambio, exige `create_products_stock`,
 * que el vendedor no tiene y no debe tener (decisión del usuario, 2026-09-25: *"el vendedor no
 * puede ajustar su bodega, solo recibe"*).
 *
 * ⚠️ EL `code` TIENE QUE COINCIDIR CON EL DEL FRONTEND (`DeliveryRoutesLayout.tsx` pregunta por
 * `hasSubmodulePermission(..., 'delivery', 'my-warehouse')`). Si no coinciden, **el item no
 * aparece y nada avisa** — es justo lo que llevaba pasando con `tracking`, al que el layout
 * llamaba `view-tracking` y el redirector `users-ubications`: seis usuarios reales sin ver su
 * menú. Hay una prueba que compara los dos lados precisamente por esto.
 *
 * Al OWNER no se le asigna: bypasea `checkPermission` y además ya ve TODAS las bodegas desde
 * INVENTARIOS, así que el item solo le añadiría un vacío. A ADMIN tampoco, por lo mismo.
 *
 * Todo idempotente (WHERE NOT EXISTS) y por `code`/`name`, nunca por UUID, para que corra igual
 * en dev y en producción.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // 1) Submódulo bajo el módulo `delivery`, ACTIVO desde el nacimiento.
            await queryInterface.sequelize.query(
                `INSERT INTO submodules (id, module_id, name, code, description, route_path, is_active, created_at, updated_at)
                 SELECT uuid_generate_v4(), m.id, 'Mis bodegas', 'my-warehouse',
                        'La bodega de la que el usuario es responsable: qué tiene y qué le viene en camino',
                        '/my-warehouse', true, now(), now()
                 FROM modules m
                 WHERE m.code = 'delivery'
                   AND NOT EXISTS (SELECT 1 FROM submodules s WHERE s.code = 'my-warehouse');`,
                { transaction: t }
            );

            // 2) Su único permiso: VER. Recibir y cuadrar ya los autoriza el encargado de la bodega.
            await queryInterface.sequelize.query(
                `INSERT INTO permissions (id, name, code, submodule_id, description, is_active, created_at, updated_at)
                 SELECT uuid_generate_v4(), 'Ver mis bodegas', 'view_own_warehouse', s.id,
                        'Permite ver el stock y los traspasos entrantes de las bodegas de las que es responsable',
                        true, now(), now()
                 FROM submodules s
                 WHERE s.code = 'my-warehouse'
                   AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = 'view_own_warehouse');`,
                { transaction: t }
            );

            // 3) Asignarlo al rol global SELLER. NOT EXISTS con company_id IS NULL: en Postgres un
            //    ON CONFLICT no deduplica cuando la columna es NULL.
            await queryInterface.sequelize.query(
                `INSERT INTO role_permissions (id, role_id, permission_id, company_id, created_at, updated_at)
                 SELECT uuid_generate_v4(), r.id, p.id, NULL, now(), now()
                 FROM roles r
                 JOIN permissions p ON p.code = 'view_own_warehouse'
                 WHERE r.name = 'SELLER' AND r.is_global = true
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
            // El orden importa: primero las asignaciones (FK), luego el permiso, luego el submódulo.
            await queryInterface.sequelize.query(
                `DELETE FROM role_permissions rp
                 USING permissions p
                 WHERE rp.permission_id = p.id AND p.code = 'view_own_warehouse';`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `DELETE FROM permissions WHERE code = 'view_own_warehouse';`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `DELETE FROM submodules WHERE code = 'my-warehouse';`,
                { transaction: t }
            );

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
