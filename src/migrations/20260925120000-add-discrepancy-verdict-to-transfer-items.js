'use strict';

/**
 * TRASPASOS — Quién ASUME la diferencia de un renglón descuadrado.
 *
 * Agrega `discrepancy_verdict` (enum) a `stock_transfer_items`. Se llena SOLO al resolver una
 * novedad, y solo en los renglones donde `received_quantity <> quantity`:
 *  - ENVIADO  → "lo enviado es la verdad" → se ajustó la bodega que RECIBE
 *  - RECIBIDO → "lo recibido es la verdad" → se ajustó la bodega que ENVÍA
 *
 * 🔴 POR QUÉ EXISTE. Hasta ahora resolver una novedad solo ponía una bandera y una nota en prosa:
 * NO movía stock. El cuadre real quedaba a cargo de que alguien se acordara de hacer un AJUSTE a
 * mano, y ese ajuste quedaba suelto, indistinguible de un error de conteo. (Caso real del
 * 2026-09-24, traspaso #10: salieron 15 abuelas y entraron 16 — una unidad nacida de la nada, que
 * se compensó a mano 53 minutos DESPUÉS de dar la novedad por cuadrada.)
 *
 * A partir de ahora la resolución mueve el stock ella misma, y esta columna deja constancia, renglón
 * por renglón, de cuál de las dos bodegas asumió la diferencia. Sin ella el detalle del traspaso no
 * puede volver a contarlo.
 *
 * Aditiva y reversible. Las novedades ya resueltas quedan en NULL, que es lo correcto: se cuadraron
 * bajo las reglas viejas y nadie declaró un veredicto.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                DO $$ BEGIN
                    CREATE TYPE public.stock_transfer_discrepancy_verdict AS ENUM
                        ('ENVIADO','RECIBIDO');
                EXCEPTION WHEN duplicate_object THEN NULL; END $$;

                ALTER TABLE public.stock_transfer_items
                    ADD COLUMN IF NOT EXISTS discrepancy_verdict
                        public.stock_transfer_discrepancy_verdict NULL;

                COMMENT ON COLUMN public.stock_transfer_items.discrepancy_verdict IS
                    'Al resolver la novedad: ENVIADO = vale lo enviado (se ajusta el destino) · RECIBIDO = vale lo recibido (se ajusta el origen). NULL = el renglón cuadraba, o se resolvió antes de 2026-09-25.';
            `, { transaction: t });
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (t) => {
            await queryInterface.sequelize.query(`
                ALTER TABLE public.stock_transfer_items DROP COLUMN IF EXISTS discrepancy_verdict;
                DROP TYPE IF EXISTS public.stock_transfer_discrepancy_verdict;
            `, { transaction: t });
        });
    },
};
