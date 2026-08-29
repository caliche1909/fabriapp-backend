'use strict';

/**
 * 🏷️ `store_visits.visit_type` — de dónde salió esta parada.
 *
 * Hasta hoy TODA parada nacía de la membresía de la ruta (`routes_stores`): al iniciar la
 * jornada se copian las tiendas de la ruta, y el botón "Ajustar" solo agrega tiendas que ya
 * pertenecen a ella. Con las **ventas ocasionales** aparece una parada que NO viene de ahí: el
 * vendedor está en la ruta Norte, lo llama un tendero de la ruta Sur y le agrega esa tienda a
 * su jornada de hoy.
 *
 * 🔑 **Por qué hace falta una columna y no basta con deducirlo.** El diagnóstico de "Ajustar"
 * busca paradas cuya tienda NO esté vinculada a la ruta y las ofrece para borrar (son las
 * huérfanas: tiendas que salieron de la ruta con la jornada abierta). Una parada ocasional
 * encaja en esa definición al milímetro, y en los datos **las dos se ven idénticas**: misma
 * ruta, mismo día, tienda no vinculada. Sin una marca explícita, la parada ocasional saldría en
 * el diálogo de Ajustar con la casilla marcada por defecto y se borraría de un clic.
 *
 * ⚠️ **La alternativa descartada** era vincular la tienda a la ruta (`routes_stores`) para que
 * el diagnóstico la viera legítima. No: esa tabla es la membresía PERMANENTE, y la tienda del
 * sur quedaría en la ruta norte mañana y todos los días siguientes.
 *
 * Valores:
 *   - `in-route`   → nació de la ruta (iniciar jornada o ajuste). **Default**, y es lo que
 *                    reciben las 17.064 filas existentes.
 *   - `occasional` → la agregó el vendedor sobre la marcha para una venta ocasional.
 *
 * La parada ocasional lleva `route_id` de la ruta que se está corriendo **a propósito**: así
 * cuenta como una parada más del día (si se compromete y no la hace, es un incumplimiento
 * real), aparece en el cajón de visitas, entra en la optimización del recorrido, la protege el
 * índice único `(store_id, route_id, visit_day)` contra duplicados y la autorización cuelga del
 * encargado actual de la ruta —así sobrevive a un relevo a media jornada—.
 *
 * 🔁 Reversible: `down` quita la columna y borra el tipo ENUM (Postgres no lo elimina solo al
 * quitar la columna, y si queda huérfano la migración no se puede volver a aplicar).
 */

const TABLA = 'store_visits';
const COLUMNA = 'visit_type';
const TIPO_ENUM = 'enum_store_visits_visit_type';

module.exports = {
    async up(queryInterface, Sequelize) {
        const sequelize = queryInterface.sequelize;
        const t = await sequelize.transaction();

        try {
            // SQL directo, como la migración del modo de ventas: `addColumn` con ENUM +
            // `comment` genera SQL malformado en Postgres (Sequelize 6). Además así queda
            // idempotente: se puede reaplicar sin romper.
            await sequelize.query(
                `DO $$
                 BEGIN
                     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${TIPO_ENUM}') THEN
                         CREATE TYPE public.${TIPO_ENUM} AS ENUM ('in-route', 'occasional');
                     END IF;
                 END $$;`,
                { transaction: t }
            );

            await sequelize.query(
                `ALTER TABLE public.${TABLA}
                 ADD COLUMN IF NOT EXISTS ${COLUMNA}
                     public.${TIPO_ENUM} NOT NULL DEFAULT 'in-route';`,
                { transaction: t }
            );

            await sequelize.query(
                `COMMENT ON COLUMN public.${TABLA}.${COLUMNA} IS
                 'Origen de la parada: in-route (nació de la ruta) | occasional (venta ocasional)';`,
                { transaction: t }
            );

            // Las filas existentes toman el DEFAULT sin reescribir la tabla (Postgres 11+).
            // Se verifica en vez de asumirlo: si alguna quedara en NULL, el NOT NULL habría
            // fallado, pero el conteo deja constancia en el log de la migración.
            const [{ total, en_ruta }] = await sequelize.query(
                `SELECT count(*)::int AS total,
                        count(*) FILTER (WHERE ${COLUMNA} = 'in-route')::int AS en_ruta
                   FROM ${TABLA}`,
                { type: Sequelize.QueryTypes.SELECT, transaction: t }
            );

            if (total !== en_ruta) {
                throw new Error(`Quedaron ${total - en_ruta} parada(s) sin marcar como 'in-route'.`);
            }

            console.log(`   ✔️ ${TABLA}.${COLUMNA} creada · ${total} parada(s) existentes marcadas como 'in-route'`);

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const sequelize = queryInterface.sequelize;
        const t = await sequelize.transaction();

        try {
            await sequelize.query(`ALTER TABLE public.${TABLA} DROP COLUMN IF EXISTS ${COLUMNA};`, { transaction: t });
            // Postgres conserva el tipo ENUM aunque ya no lo use ninguna columna: hay que
            // borrarlo a mano o quedaría huérfano en la base.
            await sequelize.query(`DROP TYPE IF EXISTS public.${TIPO_ENUM};`, { transaction: t });
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
};
