'use strict';

/**
 * BODEGAS — Ajuste de tipos + estado operativo abierta/cerrada.
 *
 * 1) Redefine el enum `inventory_location_type`:
 *      antes: ('central','estatica','movil')
 *      ahora: ('central','movil','punto_venta')
 *    Mapea las filas 'estatica' → 'punto_venta' (hoy no hay ninguna, pero se cubre por seguridad).
 *    Se quita 'estatica' y NO se incluye 'distribuidor' (fuera de alcance por ahora).
 *
 * 2) Agrega `status` (enum `inventory_location_status` = 'abierta'|'cerrada', default 'abierta').
 *    Estado OPERATIVO: una bodega 'cerrada' no puede emitir ni recibir traspasos. Es distinto de
 *    `is_active` (habilitada) y de `deleted_at` (eliminada, paranoid).
 *
 * Reversible. Postgres no permite quitar valores de un enum in-place: se hace swap de tipo con
 * mapeo en el USING.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            // 1) Swap del enum de tipos (central/movil/punto_venta), mapeando estatica→punto_venta.
            await q(`ALTER TABLE inventory_locations ALTER COLUMN type DROP DEFAULT;`);
            await q(`ALTER TYPE inventory_location_type RENAME TO inventory_location_type_old;`);
            await q(`CREATE TYPE inventory_location_type AS ENUM ('central', 'movil', 'punto_venta');`);
            await q(`
                ALTER TABLE inventory_locations
                    ALTER COLUMN type TYPE inventory_location_type
                    USING (CASE WHEN type::text = 'estatica' THEN 'punto_venta' ELSE type::text END::inventory_location_type);
            `);
            await q(`ALTER TABLE inventory_locations ALTER COLUMN type SET DEFAULT 'central';`);
            await q(`DROP TYPE inventory_location_type_old;`);

            // 2) Nuevo estado operativo abierta/cerrada.
            await q(`
                DO $$ BEGIN
                    CREATE TYPE inventory_location_status AS ENUM ('abierta', 'cerrada');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            `);
            await q(`
                ALTER TABLE inventory_locations
                    ADD COLUMN IF NOT EXISTS status inventory_location_status NOT NULL DEFAULT 'abierta';
            `);
            await q(`COMMENT ON COLUMN inventory_locations.status IS 'Estado operativo: cerrada no emite/recibe traspasos. Distinto de is_active y deleted_at';`);
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction: t });

            // 2) Quitar status + su enum.
            await q(`ALTER TABLE inventory_locations DROP COLUMN IF EXISTS status;`);
            await q(`DROP TYPE IF EXISTS inventory_location_status;`);

            // 1) Volver al enum anterior (central/estatica/movil), mapeando punto_venta→estatica.
            await q(`ALTER TABLE inventory_locations ALTER COLUMN type DROP DEFAULT;`);
            await q(`ALTER TYPE inventory_location_type RENAME TO inventory_location_type_old;`);
            await q(`CREATE TYPE inventory_location_type AS ENUM ('central', 'estatica', 'movil');`);
            await q(`
                ALTER TABLE inventory_locations
                    ALTER COLUMN type TYPE inventory_location_type
                    USING (CASE WHEN type::text = 'punto_venta' THEN 'estatica' ELSE type::text END::inventory_location_type);
            `);
            await q(`ALTER TABLE inventory_locations ALTER COLUMN type SET DEFAULT 'central';`);
            await q(`DROP TYPE inventory_location_type_old;`);
        });
    },
};
