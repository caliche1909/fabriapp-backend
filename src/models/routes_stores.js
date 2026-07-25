const Sequelize = require('sequelize');

/**
 * 🔗 routes_stores — Tabla intermedia (muchos-a-muchos) entre rutas y tiendas.
 *
 * Permite que una misma tienda pertenezca a VARIAS rutas. Reemplaza gradualmente
 * a `stores.route_id` (relación 1→1), que se conserva durante la transición y se
 * elimina en la fase final. Creada por la migración 20260715174831.
 */
module.exports = function (sequelize, DataTypes) {
  const RoutesStores = sequelize.define('routes_stores', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'routes', key: 'id' },
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'stores', key: 'id' },
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' },
      comment: 'Compañía dueña del vínculo (aislamiento multi-tenant)',
    },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Orden del recorrido de la tienda dentro de la ruta (opcional)',
    },
  }, {
    sequelize,
    tableName: 'routes_stores',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'routes_stores_pkey', unique: true, fields: [{ name: 'id' }] },
      { name: 'uq_routes_stores_route_store', unique: true, fields: [{ name: 'route_id' }, { name: 'store_id' }] },
      { name: 'idx_routes_stores_route_id', fields: [{ name: 'route_id' }] },
      { name: 'idx_routes_stores_store_id', fields: [{ name: 'store_id' }] },
      { name: 'idx_routes_stores_company_id', fields: [{ name: 'company_id' }] },
    ],
  });

  RoutesStores.associate = (models) => {
    RoutesStores.belongsTo(models.routes, { foreignKey: 'route_id', as: 'route' });
    RoutesStores.belongsTo(models.stores, { foreignKey: 'store_id', as: 'store' });
    RoutesStores.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
  };

  return RoutesStores;
};
