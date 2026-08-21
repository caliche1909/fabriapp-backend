const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🧂 LÍNEAS DE RECETA. Cada línea consume un INSUMO (inventory_supplies) en cierta
  // cantidad. supply_id con ON DELETE RESTRICT: no se puede borrar un insumo usado en una
  // receta (protege el costeo). Paranoid + auditoría.
  const RecipeItems = sequelize.define('recipe_items', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    recipe_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'recipes', key: 'id' },
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
      validate: { min: 0.001 }
    },
    unit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'measurement_units', key: 'id' },
      onDelete: 'RESTRICT'
    },
    notes: {
      type: DataTypes.TEXT,
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
      comment: 'Usuario que eliminó la línea (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'recipe_items',
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
      { name: 'idx_recipe_items_recipe', fields: [{ name: 'recipe_id' }] },
      { name: 'idx_recipe_items_supply', fields: [{ name: 'supply_id' }] }
    ]
  });

  RecipeItems.associate = (models) => {
    RecipeItems.belongsTo(models.recipes, { foreignKey: 'recipe_id', as: 'recipe' });
    RecipeItems.belongsTo(models.inventory_supplies, { foreignKey: 'supply_id', as: 'supply' });
    RecipeItems.belongsTo(models.measurement_units, { foreignKey: 'unit_id', as: 'unit' });
    RecipeItems.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
  };

  return RecipeItems;
};
