'use strict';

/**
 * 🧾 `companies.sales_inventory_mode` — CÓMO vende cada compañía.
 *
 * No todas las empresas quieren llevar inventario. Este ajuste (editable desde el submódulo
 * "Configuraciones") decide qué hace una venta con el stock:
 *
 *   - `sin_inventario`     → se vende del CATÁLOGO de productos y NO se descuenta nada.
 *                            La compañía no necesita crear ni surtir bodegas.
 *   - `descuenta_central`  → se vende del stock de la bodega CENTRAL y se descuenta de ella.
 *                            Sirve a quien lleva inventario pero sin bodega por vendedor.
 *   - `descuenta_bodegas`  → cada vendedor vende de SU bodega y se descuenta de ella
 *                            (el modelo de traspasos actual).
 *
 * Por defecto `sin_inventario`: una compañía nueva puede vender desde el primer día sin
 * configurar nada, y quien quiera control de inventario lo activa. Las compañías existentes
 * quedan también en `sin_inventario` — hoy ninguna opera con bodegas (ninguna bodega tiene
 * responsable asignado, así que ninguna venta descuenta stock todavía).
 *
 * El nombre del tipo sigue la convención de Sequelize (`enum_<tabla>_<columna>`) para que
 * el modelo con `DataTypes.ENUM` calce con lo que hay en la BD.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        const t = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.sequelize.query(
                `DO $$
                 BEGIN
                     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_companies_sales_inventory_mode') THEN
                         CREATE TYPE public.enum_companies_sales_inventory_mode
                             AS ENUM ('sin_inventario', 'descuenta_central', 'descuenta_bodegas');
                     END IF;
                 END $$;`,
                { transaction: t }
            );

            await queryInterface.sequelize.query(
                `ALTER TABLE public.companies
                 ADD COLUMN IF NOT EXISTS sales_inventory_mode
                     public.enum_companies_sales_inventory_mode NOT NULL DEFAULT 'sin_inventario';`,
                { transaction: t }
            );

            await queryInterface.sequelize.query(
                `COMMENT ON COLUMN public.companies.sales_inventory_mode IS
                  'Cómo afecta una venta al stock: sin_inventario (no descuenta) | descuenta_central (bodega central) | descuenta_bodegas (bodega del vendedor)';`,
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
            await queryInterface.sequelize.query(
                `ALTER TABLE public.companies DROP COLUMN IF EXISTS sales_inventory_mode;`,
                { transaction: t }
            );
            await queryInterface.sequelize.query(
                `DROP TYPE IF EXISTS public.enum_companies_sales_inventory_mode;`,
                { transaction: t }
            );

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
};
