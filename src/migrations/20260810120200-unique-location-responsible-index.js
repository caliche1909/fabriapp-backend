'use strict';

/**
 * Regla de negocio (B-D10) respaldada en BD: **un usuario puede ser encargado de una sola bodega
 * por compañía**. Hasta ahora solo se validaba en el controlador (`warehouses_controller` create/
 * update), lo que deja una carrera TOCTOU: dos peticiones concurrentes podían asignar el mismo
 * responsable a dos bodegas y ambas commitear. Como "encargado de la bodega" es una de las 3 vías
 * de autorización (recibir traspasos, ajustar stock), conviene una garantía dura.
 *
 * Índice único PARCIAL sobre (company_id, user_id) contando solo bodegas VIVAS con encargado
 * asignado (user_id IS NOT NULL AND deleted_at IS NULL). No afecta a las bodegas sin encargado
 * (varias pueden tener user_id NULL) ni a las soft-deleted.
 *
 * ⚠️ Si ya existiera un usuario asignado a 2+ bodegas vivas de una misma compañía, la creación del
 * índice FALLA (no modifica datos). En ese caso hay que resolver el duplicado antes de migrar.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_locations_company_responsible
                ON public.inventory_locations (company_id, user_id)
                WHERE user_id IS NOT NULL AND deleted_at IS NULL;
        `);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(`
            DROP INDEX IF EXISTS public.uq_inventory_locations_company_responsible;
        `);
    },
};
