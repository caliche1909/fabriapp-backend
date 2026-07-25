'use strict';

/**
 * FASE 7 — Limpieza destructiva.
 * Elimina de `stores` las columnas heredadas que ya no se usan:
 *   - route_id            (la relación tienda↔ruta vive en routes_stores, M2M)
 *   - current_visit_status(el estado de visita vive en store_visits)
 *   - current_visit_id
 * Al eliminar las columnas, PostgreSQL descarta automáticamente sus índices y FKs.
 *
 * ⚠️ IRREVERSIBLE en cuanto a datos: el `down` recrea la ESTRUCTURA y hace un
 * backfill APROXIMADO (route_id desde routes_stores; current_visit_* desde la
 * visita más reciente de cada tienda), suficiente para volver a arrancar el
 * backend anterior, pero NO restaura el valor exacto que tenían las columnas.
 *
 * Prerrequisito: el backend desplegado NO debe leer/escribir estas columnas
 * (se hizo en la Fase 7 de código antes de correr esta migración).
 */
module.exports = {
  async up(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `ALTER TABLE "public"."stores"
           DROP COLUMN IF EXISTS "route_id",
           DROP COLUMN IF EXISTS "current_visit_id",
           DROP COLUMN IF EXISTS "current_visit_status";`,
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
      // 1) Recrear columnas (nullable / con default) + FKs.
      await queryInterface.sequelize.query(
        `ALTER TABLE "public"."stores"
           ADD COLUMN IF NOT EXISTS "route_id" INTEGER NULL
             REFERENCES "public"."routes"("id"),
           ADD COLUMN IF NOT EXISTS "current_visit_id" INTEGER NULL
             REFERENCES "public"."store_visits"("id"),
           ADD COLUMN IF NOT EXISTS "current_visit_status" VARCHAR(20) NOT NULL DEFAULT 'pending';`,
        { transaction: t }
      );

      // CHECK del estado de visita (equivalente al validate isIn del modelo).
      await queryInterface.sequelize.query(
        `ALTER TABLE "public"."stores"
           ADD CONSTRAINT "stores_current_visit_status_check"
           CHECK ("current_visit_status" IN ('pending','visited','completed'));`,
        { transaction: t }
      );

      // 2) Backfill APROXIMADO desde el nuevo modelo.
      //    route_id: una de las rutas de la tienda (la menor) según routes_stores.
      await queryInterface.sequelize.query(
        `UPDATE "public"."stores" s
           SET "route_id" = (
             SELECT rs.route_id FROM "public"."routes_stores" rs
             WHERE rs.store_id = s.id ORDER BY rs.route_id ASC LIMIT 1
           );`,
        { transaction: t }
      );

      //    current_visit_id / current_visit_status: desde la visita más reciente.
      await queryInterface.sequelize.query(
        `UPDATE "public"."stores" s
           SET "current_visit_id" = v.id,
               "current_visit_status" = v.status
           FROM (
             SELECT DISTINCT ON (sv.store_id) sv.store_id, sv.id, sv.status
             FROM "public"."store_visits" sv
             ORDER BY sv.store_id, sv.date DESC
           ) v
           WHERE v.store_id = s.id;`,
        { transaction: t }
      );

      // 3) Recrear índices originales.
      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS "idx_stores_route_id" ON "public"."stores" ("route_id");
         CREATE INDEX IF NOT EXISTS "idx_stores_company_route" ON "public"."stores" ("company_id","route_id");
         CREATE INDEX IF NOT EXISTS "idx_stores_route_visit_status" ON "public"."stores" ("route_id","current_visit_status");
         CREATE INDEX IF NOT EXISTS "idx_stores_visit_status" ON "public"."stores" ("current_visit_status");`,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
