const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 📊 SNAPSHOT de stock por (producto, bodega). DERIVADO: lo escribe SOLO el trigger
  // apply_product_stock_movement (al insertar movimientos). Sin soft-delete (su vida está
  // atada al producto/bodega vía CASCADE). balance >= 0.
  const ProductStockBalances = sequelize.define('product_stock_balances', {
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
      comment: 'Compañía dueña (desnormalizado para consultas de balance sin JOIN)'
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
      onDelete: 'CASCADE'
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_locations', key: 'id' },
      onDelete: 'CASCADE'
    },
    balance: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    last_updated: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'product_stock_balances',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false,
    hasTrigger: true,
    indexes: [
      { name: 'uq_product_stock_balances_product_location', unique: true, fields: [{ name: 'product_id' }, { name: 'location_id' }] },
      { name: 'idx_product_stock_balances_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_product_stock_balances_company_location', fields: [{ name: 'company_id' }, { name: 'location_id' }] },
      { name: 'idx_product_stock_balances_location', fields: [{ name: 'location_id' }] }
    ]
  });

  ProductStockBalances.associate = (models) => {
    ProductStockBalances.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    ProductStockBalances.belongsTo(models.products, { foreignKey: 'product_id', as: 'product' });
    ProductStockBalances.belongsTo(models.inventory_locations, { foreignKey: 'location_id', as: 'location' });
  };

  return ProductStockBalances;
};
