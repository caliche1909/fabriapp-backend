'use strict';

/**
 * ✍️ Reformula el permiso `start_route_for_others`, que cambió de significado.
 *
 * ANTES: quien lo tenía elegía en un desplegable **a nombre de qué usuario** se creaba la
 * jornada. Eso permitía que la lista de una ruta acabara a nombre de alguien que no era su
 * vendedor, y de ahí venían dos problemas: no se sabía de quién era realmente la jornada, y
 * el bypass se usaba también para arrancar rutas en días que no eran los suyos.
 *
 * AHORA: la jornada se crea **siempre** a nombre del vendedor asignado a la ruta
 * (`routes.user_id`). No hay destinatario que elegir. El permiso solo habilita **pulsar
 * iniciar en la ruta de OTRO vendedor** (típicamente para dejarla preparada), y la lista
 * sigue siendo de su vendedor.
 *
 * El permiso NO se elimina: sigue existiendo esa capacidad y ya está asignado en producción
 * (esta migración solo corrige el texto que ve quien configura los roles). Tampoco habilita
 * saltarse los días hábiles de la ruta: eso quedó reservado al owner.
 *
 * Solo toca `name`/`description`; no altera asignaciones ni estructura.
 *
 * @type {import('sequelize-cli').Migration}
 */
const NUEVO = {
    name: 'Iniciar la ruta de otro vendedor',
    description: 'Permite iniciar o programar una ruta asignada a otro vendedor. La jornada se crea siempre a nombre del vendedor asignado a la ruta.',
};

const ANTERIOR = {
    name: 'Iniciar ruta para otro usuario',
    description: 'Permite iniciar una ruta a nombre de otro usuario de la empresa',
};

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            `UPDATE permissions SET name = :name, description = :description, updated_at = now()
              WHERE code = 'start_route_for_others';`,
            { replacements: NUEVO }
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            `UPDATE permissions SET name = :name, description = :description, updated_at = now()
              WHERE code = 'start_route_for_others';`,
            { replacements: ANTERIOR }
        );
    },
};
