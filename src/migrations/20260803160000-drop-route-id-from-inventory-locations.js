'use strict';

/**
 * BODEGAS — Eliminar `route_id` de `inventory_locations`.
 *
 * La bodega MÓVIL representa un vehículo/persona, no una ruta: se ancla al RESPONSABLE
 * (`user_id`), no a la ruta. El vínculo vendedor↔ruta ya vive en `routes.user_id` y
 * tiendas↔rutas en `routes_stores`. `route_id` estaba nullable y sin uso ("uso futuro"),
 * así que se elimina para dejar el modelo honesto.
 *
 * Al hacer DROP COLUMN, Postgres descarta también su índice (`idx_inventory_locations_route`)
 * y la FK asociada. El `down` recrea la columna + FK (ON DELETE SET NULL) + índice.
 *
 * Aditiva-inversa y reversible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            `ALTER TABLE inventory_locations DROP COLUMN IF EXISTS route_id;`
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });
            await q(`
                ALTER TABLE inventory_locations
                    ADD COLUMN IF NOT EXISTS route_id INTEGER NULL
                    REFERENCES routes(id) ON DELETE SET NULL;
            `);
            await q(`COMMENT ON COLUMN inventory_locations.route_id IS 'Ruta asociada a la bodega móvil (opcional, uso futuro)';`);
            await q(`CREATE INDEX IF NOT EXISTS idx_inventory_locations_route ON inventory_locations (route_id);`);
        });
    },
};
