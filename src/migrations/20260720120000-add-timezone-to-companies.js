'use strict';

/**
 * Agrega la columna `timezone` a `companies`.
 *
 * Cada compañía puede configurar su propia zona horaria IANA (ej. 'America/Bogota',
 * 'America/Mexico_City', 'Europe/Madrid'). Hasta ahora la app asumía 'America/Bogota'
 * hardcodeada en reportes y en el cálculo del "día hábil"; este campo es el primer paso
 * para dejar de asumirlo (Capa A: capturar/almacenar la zona por compañía).
 *
 * - NOT NULL con DEFAULT 'America/Bogota' para que las compañías existentes conserven
 *   el comportamiento actual sin quedar con valor nulo.
 * - VARCHAR(64): los identificadores IANA más largos rondan los ~30 caracteres.
 */
module.exports = {
  async up(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `ALTER TABLE "public"."companies"
           ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Bogota';`,
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
        `ALTER TABLE "public"."companies"
           DROP COLUMN IF EXISTS "timezone";`,
        { transaction: t }
      );
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
