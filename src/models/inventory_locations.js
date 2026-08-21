const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🏬 BODEGAS (central / estática / móvil). Pivote del stock de productos:
  // el stock se lleva por (producto, bodega). Paranoid + auditoría (deleted_by).
  const InventoryLocations = sequelize.define('inventory_locations', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' },
      onDelete: 'CASCADE',
      comment: 'Compañía dueña de la bodega (aislamiento multi-tenant)'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true }
    },
    type: {
      type: DataTypes.ENUM('central', 'movil', 'punto_venta'),
      allowNull: false,
      defaultValue: 'central'
    },
    status: {
      type: DataTypes.ENUM('abierta', 'cerrada'),
      allowNull: false,
      defaultValue: 'abierta',
      comment: 'Estado operativo: cerrada no emite/recibe traspasos. Distinto de is_active y deleted_at'
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Bodega central por defecto de la compañía (única viva por compañía)'
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Responsable de la bodega (opcional / nullable). En móvil suele ser el vendedor.'
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de eliminación lógica. NULL = activa'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó la bodega (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'inventory_locations',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    hasTrigger: true,
    hooks: {
      beforeDestroy: (instance, options) => {
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      beforeRestore: (instance) => {
        instance.deleted_by = null;
      }
    },
    indexes: [
      { name: 'idx_inventory_locations_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_inventory_locations_company_type', fields: [{ name: 'company_id' }, { name: 'type' }] },
      { name: 'idx_inventory_locations_user', fields: [{ name: 'user_id' }] }
    ]
  });

  InventoryLocations.associate = (models) => {
    InventoryLocations.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    InventoryLocations.belongsTo(models.users, { foreignKey: 'user_id', as: 'user' });
    InventoryLocations.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });

    InventoryLocations.hasMany(models.product_stock_balances, { foreignKey: 'location_id', as: 'balances' });
    InventoryLocations.hasMany(models.product_stock_movements, { foreignKey: 'location_id', as: 'movements' });
  };

  return InventoryLocations;
};
