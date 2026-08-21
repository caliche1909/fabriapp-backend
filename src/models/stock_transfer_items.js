const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 📦 DETALLE de un traspaso: 1 fila por producto. `transfer_id` enlaza con la cabecera
  // (stock_transfers). `quantity` = lo que se PRETENDE mover; `received_quantity` = lo que
  // realmente se recibió (para faltantes/novedades). Snapshots de costo/venta/margen al emitir.
  // Sin soft-delete: su vida está atada a la cabecera (ON DELETE CASCADE).
  const StockTransferItems = sequelize.define('stock_transfer_items', {
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
      comment: 'Compañía dueña (desnormalizado para consultas por tenant)'
    },
    transfer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'stock_transfers', key: 'id' },
      onDelete: 'CASCADE',
      comment: 'Cabecera del traspaso a la que pertenece este ítem'
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
      onDelete: 'RESTRICT'
    },
    quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      validate: { min: 0 },
      comment: 'Cantidad que se pretende mover (sale del origen)'
    },
    received_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Cantidad realmente recibida en destino (NULL hasta confirmar recepción)'
    },
    unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Snapshot del COSTO de producción al emitir el traspaso'
    },
    sale_price_snapshot: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Snapshot del PRECIO DE VENTA al emitir'
    },
    margin_snapshot: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
      comment: 'Snapshot del MARGEN (%) al emitir; NULL si no hay costo o venta'
    }
  }, {
    sequelize,
    tableName: 'stock_transfer_items',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false,
    hasTrigger: true,
    indexes: [
      { name: 'uq_sti_transfer_product', unique: true, fields: [{ name: 'transfer_id' }, { name: 'product_id' }] },
      { name: 'idx_sti_transfer', fields: [{ name: 'transfer_id' }] },
      { name: 'idx_sti_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_sti_product', fields: [{ name: 'product_id' }] }
    ]
  });

  StockTransferItems.associate = (models) => {
    StockTransferItems.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    StockTransferItems.belongsTo(models.stock_transfers, { foreignKey: 'transfer_id', as: 'transfer' });
    StockTransferItems.belongsTo(models.products, { foreignKey: 'product_id', as: 'product' });
  };

  return StockTransferItems;
};
