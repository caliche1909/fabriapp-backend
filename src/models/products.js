const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 📦 CATÁLOGO DE PRODUCTOS terminados (productos simples, sin variantes; cada
  // presentación = su propio producto/SKU). Tenant-scoped. NO guarda cantidad: el
  // stock vive en product_stock_balances/movements por (producto, bodega).
  // Paranoid + auditoría (deleted_by).
  const Products = sequelize.define('products', {
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
      comment: 'Compañía dueña del producto (aislamiento multi-tenant)'
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'product_categories', key: 'id' },
      onDelete: 'SET NULL'
    },
    presentation_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'product_presentations', key: 'id' },
      onDelete: 'SET NULL',
      comment: 'Presentación de venta (catálogo product_presentations por compañía)'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true }
    },
    sku: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Código interno (único por compañía entre los vivos)'
    },
    barcode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Código de barras (opcional)'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sale_price: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    production_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
      comment: 'Costo unitario calculado desde la receta (cache)'
    },
    min_stock: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
      comment: 'Punto de reorden (alerta de stock bajo)'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    image_url: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de eliminación lógica. NULL = activo'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó el producto (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'products',
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
      { name: 'idx_products_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_products_company_active', fields: [{ name: 'company_id' }, { name: 'is_active' }] },
      { name: 'idx_products_category', fields: [{ name: 'category_id' }] },
      { name: 'idx_products_presentation', fields: [{ name: 'presentation_id' }] }
    ]
  });

  Products.associate = (models) => {
    Products.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    Products.belongsTo(models.product_categories, { foreignKey: 'category_id', as: 'category' });
    Products.belongsTo(models.product_presentations, { foreignKey: 'presentation_id', as: 'presentation' });
    Products.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });

    Products.hasMany(models.recipes, { foreignKey: 'product_id', as: 'recipes' });
    Products.hasMany(models.product_stock_balances, { foreignKey: 'product_id', as: 'balances' });
    Products.hasMany(models.product_stock_movements, { foreignKey: 'product_id', as: 'movements' });
  };

  return Products;
};
