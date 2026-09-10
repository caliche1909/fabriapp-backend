'use strict';

/**
 * 🧾 `sales.conflict_reason` — por qué una venta quedó apartada.
 *
 * EL PROBLEMA. Una venta hecha sin señal puede llegar al servidor cuando ya no cabe: la parada se
 * cerró con un reporte de no compra, o reasignaron la ruta. Hasta ahora se rechazaba, y esa venta
 * —que el vendedor **ya cobró**— no quedaba registrada en ninguna parte. El teléfono mostraba un
 * aviso rojo que nadie podía cerrar, y el dinero se perdía de vista.
 *
 * LA SOLUCIÓN. La venta se crea igual, pero **apartada**: nace con `deleted_at` puesto y con el
 * motivo aquí. Así llega a Postgres —con su importe, sus ítems, su tienda, su vendedor y su hora—
 * sin contaminar ningún informe, y el supervisor puede verla y actuar.
 *
 * 🔴 POR QUÉ `deleted_at` Y NO UNA COLUMNA `with_conflict`. Porque **las 16 consultas que leen
 * `sales` ya excluyen `deleted_at IS NULL`**, sin excepción, y Sequelize lo aplica solo en el
 * modelo (`paranoid: true`). Un booleano nuevo habría que acordarse de filtrarlo en cada consulta
 * que se escriba de aquí en adelante, y **olvidarlo una sola vez es dinero contado dos veces en un
 * informe**, en silencio. `deleted_at` no depende de que nadie recuerde nada.
 *
 * Medido antes de decidirlo: 11.388 ventas, **0 borradas y 0 anuladas**. El borrado lógico de
 * `sales` estaba construido y sin usar, así que no hay ambigüedad que resolver.
 *
 * 🔴 Y POR QUÉ HACE FALTA ESTA COLUMNA IGUALMENTE. Es lo que distingue una venta **apartada por
 * conflicto** de una venta **anulada por una persona** el día que exista esa función (`voided`
 * tendrá `conflict_reason` en NULL). Y sobre todo: sin el motivo, el supervisor ve "venta de
 * $45.000 a La Esquina, martes 11:20, apartada" y **no sabe qué hacer con ella**. Con el motivo
 * sabe exactamente qué pasó y a quién llamar.
 *
 * Coste: una columna de texto anulable es **solo metadatos** en PostgreSQL — no reescribe filas,
 * no bloquea la tabla y se revierte en una línea.
 *
 * Diseño completo en `OFFLINE-CAMPO.md` §11.
 *
 * @type {import('sequelize-cli').Migration}
 */

const COMENTARIO = 'Motivo por el que la venta quedó apartada (llegó cuando ya no cabía). '
    + 'NULL = venta normal. Va siempre junto a deleted_at. Ver OFFLINE-CAMPO.md §11.';

module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.sequelize.query(
                `ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS conflict_reason text NULL;`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `COMMENT ON COLUMN public.sales.conflict_reason IS '${COMENTARIO}';`,
                { transaction: t }
            );
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        // Reversible sin pérdida de ventas: solo se pierde el motivo. Las filas apartadas siguen
        // ahí con su `deleted_at`, que es lo que las mantiene fuera de los informes.
        await queryInterface.sequelize.query(
            `ALTER TABLE public.sales DROP COLUMN IF EXISTS conflict_reason;`
        );
    },
};
