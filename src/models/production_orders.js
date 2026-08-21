const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🏭 ÓRDENES DE PRODUCCIÓN. Registran qué se produce cada día y a qué costo real.
  // Al completar (lógica futura) consumirá insumos (supplies_stock -) y producirá stock
  // del producto (movimiento PRODUCCION +), calculando unit_cost/total_cost.
  // Paranoid + auditoría.
  const ProductionOrders = sequelize.define('production_orders', {
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
      onDelete: 'CASCADE'
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
      onDelete: 'RESTRICT'
    },
    recipe_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'recipes', key: 'id' },
      onDelete: 'SET NULL'
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_locations', key: 'id' },
      onDelete: 'RESTRICT',
      comment: 'Bodega destino de lo producido (normalmente la central)'
    },
    quantity_produced: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    production_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_DATE'),
      comment: 'Día de producción (para "qué se produjo hoy")'
    },
    status: {
      type: DataTypes.ENUM('planificada', 'en_proceso', 'completada', 'cancelada'),
      allowNull: false,
      defaultValue: 'planificada'
    },
    unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Costo unitario calculado al completar'
    },
    total_cost: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      validate: { min: 0 }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Usuario que registró la orden'
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó la orden (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'production_orders',
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
      { name: 'idx_production_orders_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_production_orders_company_date', fields: [{ name: 'company_id' }, { name: 'production_date' }] },
      { name: 'idx_production_orders_product', fields: [{ name: 'product_id' }] },
      { name: 'idx_production_orders_status', fields: [{ name: 'status' }] },
      { name: 'idx_production_orders_location', fields: [{ name: 'location_id' }] }
    ]
  });

  ProductionOrders.associate = (models) => {
    ProductionOrders.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    ProductionOrders.belongsTo(models.products, { foreignKey: 'product_id', as: 'product' });
    ProductionOrders.belongsTo(models.recipes, { foreignKey: 'recipe_id', as: 'recipe' });
    ProductionOrders.belongsTo(models.inventory_locations, { foreignKey: 'location_id', as: 'location' });
    ProductionOrders.belongsTo(models.users, { foreignKey: 'user_id', as: 'user' });
    ProductionOrders.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
    ProductionOrders.hasMany(models.production_consumptions, { foreignKey: 'production_order_id', as: 'consumptions' });
  };

  return ProductionOrders;
};
