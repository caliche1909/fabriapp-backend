const Sequelize = require('sequelize');
module.exports = function (sequelize, DataTypes) {
  // 🧾 DETALLE de una venta (1 fila por producto). Ledger INMUTABLE: el registro + `created_at` ES la
  // auditoría (sin `updated_at` ni soft-delete). Guarda SNAPSHOTS del nombre, precio de venta y costo
  // de producción al momento de la venta → el margen histórico queda congelado aunque luego cambien.
  const SaleItems = sequelize.define('sale_items', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    sale_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'sales', key: 'id' },
      onDelete: 'CASCADE' // los ítems mueren con la venta
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' },
      onDelete: 'CASCADE',
      comment: 'Denormalizado (compañía de la venta) para reportes tenant-scoped sin JOIN'
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
      onDelete: 'RESTRICT' // no se borra un producto con ventas
    },
    product_name: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Snapshot del nombre del producto al momento de la venta'
    },
    quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      validate: { min: 0 } // el CHECK de la BD exige > 0; el controlador también lo valida
    },
    unit_price: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: { min: 0 },
      comment: 'Snapshot del PRECIO DE VENTA del producto al momento de la venta'
    },
    unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Snapshot del COSTO de producción al momento (NULL si el producto no tiene costo)'
    },
    total_price: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: { min: 0 },
      comment: '= quantity × unit_price (estampado por el servidor)'
    }
  }, {
    sequelize,
    tableName: 'sale_items',
    schema: 'public',
    freezeTableName: true,
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false, // ledger inmutable: no se actualiza
    paranoid: false,
    indexes: [
      { name: 'idx_si_sale', fields: [{ name: 'sale_id' }] },
      { name: 'idx_si_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_si_product', fields: [{ name: 'product_id' }] },
      { name: 'uq_si_sale_product', unique: true, fields: [{ name: 'sale_id' }, { name: 'product_id' }] },
      { name: 'sale_items_pkey', unique: true, fields: [{ name: 'id' }] }
    ]
  });

  SaleItems.associate = (models) => {
    SaleItems.belongsTo(models.sales, { foreignKey: 'sale_id', as: 'sale', onDelete: 'CASCADE' });
    SaleItems.belongsTo(models.products, { foreignKey: 'product_id', as: 'product', onDelete: 'RESTRICT' });
    SaleItems.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company', onDelete: 'CASCADE' });
  };

  return SaleItems;
};
