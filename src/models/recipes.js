const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🍞 RECETAS. Define qué insumos consume un producto para calcular su costo de
  // producción (que se cachea en products.production_cost). Una receta ACTIVA por
  // producto (índice único parcial en BD). Paranoid + auditoría.
  const Recipes = sequelize.define('recipes', {
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
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Nombre/versión de la receta (opcional)'
    },
    yield_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 1,
      validate: { min: 0.001 },
      comment: 'Unidades producidas por lote'
    },
    preparation: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    notes: {
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
      allowNull: true
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó la receta (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'recipes',
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
      { name: 'idx_recipes_company', fields: [{ name: 'company_id' }] },
      { name: 'idx_recipes_product', fields: [{ name: 'product_id' }] }
    ]
  });

  Recipes.associate = (models) => {
    Recipes.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    Recipes.belongsTo(models.products, { foreignKey: 'product_id', as: 'product' });
    Recipes.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
    Recipes.hasMany(models.recipe_items, { foreignKey: 'recipe_id', as: 'items' });
  };

  return Recipes;
};
