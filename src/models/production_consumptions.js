const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 📉 CONSUMOS DE PRODUCCIÓN. Snapshot de los insumos realmente consumidos por una orden,
  // con su unit_cost al momento (los costos de insumo cambian) → costeo real trazable.
  // Paranoid + auditoría.
  const ProductionConsumptions = sequelize.define('production_consumptions', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    production_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'production_orders', key: 'id' },
      onDelete: 'CASCADE'
    },
    supply_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_supplies', key: 'id' },
      onDelete: 'RESTRICT'
    },
    quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      validate: { min: 0 }
    },
    unit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'measurement_units', key: 'id' },
      onDelete: 'RESTRICT'
    },
    unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Costo del insumo al momento de la producción'
    },
    total_cost: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      validate: { min: 0 }
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó el consumo (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'production_consumptions',
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
      { name: 'idx_production_consumptions_order', fields: [{ name: 'production_order_id' }] },
      { name: 'idx_production_consumptions_supply', fields: [{ name: 'supply_id' }] }
    ]
  });

  ProductionConsumptions.associate = (models) => {
    ProductionConsumptions.belongsTo(models.production_orders, { foreignKey: 'production_order_id', as: 'production_order' });
    ProductionConsumptions.belongsTo(models.inventory_supplies, { foreignKey: 'supply_id', as: 'supply' });
    ProductionConsumptions.belongsTo(models.measurement_units, { foreignKey: 'unit_id', as: 'unit' });
    ProductionConsumptions.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
  };

  return ProductionConsumptions;
};
