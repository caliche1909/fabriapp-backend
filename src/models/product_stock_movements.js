const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🧾 LEDGER de movimientos de stock de productos. Append-only INMUTABLE: el propio
  // registro + user_id ES la auditoría (sin updated_at ni soft-delete). El signo de
  // quantity_change manda; el trigger apply_product_stock_movement actualiza el balance
  // y RECHAZA si quedaría negativo. Los errores se corrigen con un movimiento de reversa.
  const ProductStockMovements = sequelize.define('product_stock_movements', {
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
      onDelete: 'CASCADE'
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'inventory_locations', key: 'id' },
      onDelete: 'RESTRICT',
      comment: 'Bodega afectada por esta pata del movimiento'
    },
    quantity_change: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      comment: 'Delta con signo (+ entra, - sale). El signo define la matemática del balance'
    },
    movement_type: {
      type: DataTypes.ENUM('ENTRADA', 'SALIDA', 'AJUSTE', 'TRASPASO_SALIDA', 'TRASPASO_ENTRADA', 'PRODUCCION'),
      allowNull: false
    },
    transfer_group_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Enlaza las 2 patas de un traspaso (salida/entrada)'
    },
    destination_kind: {
      type: DataTypes.ENUM('BODEGA_MOVIL', 'PUNTO_VENTA', 'DISTRIBUIDOR', 'MERMA', 'OTRO'),
      allowNull: true,
      comment: 'Solo en SALIDA: a dónde/por qué salió (etiqueta hoy; será traspaso a bodega real a futuro)'
    },
    unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Snapshot del COSTO de producción del producto al momento del movimiento (estampado por el servidor)'
    },
    sale_price_snapshot: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      validate: { min: 0 },
      comment: 'Snapshot del PRECIO DE VENTA del producto al momento del movimiento'
    },
    margin_snapshot: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
      comment: 'Snapshot del MARGEN (%) al momento del movimiento; NULL si no hay costo o venta'
    },
    reference_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: "Origen del movimiento: 'sale', 'production_order', 'stock_transfer', 'manual'..."
    },
    reference_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID del registro de origen (venta, orden de producción, traspaso...)'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL'
    }
  }, {
    sequelize,
    tableName: 'product_stock_movements',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: false, // ledger inmutable: no se actualiza
    paranoid: false,
    hasTrigger: true,
    indexes: [
      { name: 'idx_psm_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_psm_product', fields: [{ name: 'product_id' }] },
      { name: 'idx_psm_location', fields: [{ name: 'location_id' }] },
      { name: 'idx_psm_product_location', fields: [{ name: 'product_id' }, { name: 'location_id' }] },
      { name: 'idx_psm_type', fields: [{ name: 'movement_type' }] },
      { name: 'idx_psm_created_at', fields: [{ name: 'created_at' }] },
      { name: 'idx_psm_reference', fields: [{ name: 'reference_type' }, { name: 'reference_id' }] }
    ]
  });

  ProductStockMovements.associate = (models) => {
    ProductStockMovements.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    ProductStockMovements.belongsTo(models.products, { foreignKey: 'product_id', as: 'product' });
    ProductStockMovements.belongsTo(models.inventory_locations, { foreignKey: 'location_id', as: 'location' });
    ProductStockMovements.belongsTo(models.users, { foreignKey: 'user_id', as: 'user' });
  };

  return ProductStockMovements;
};
