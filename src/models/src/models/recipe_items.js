const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('recipe_items', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    recipe_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'recipes',
        key: 'id'
      }
    },
    supply_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'supplies',
        key: 'id'
      }
    },
    quantity: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    unit: {
      type: DataTypes.STRING(20),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'recipe_items',
    schema: 'public',
    hasTrigger: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_recipe_items_recipe_id",
        fields: [
          { name: "recipe_id" },
        ]
      },
      {
        name: "idx_recipe_items_supply_id",
        fields: [
          { name: "supply_id" },
        ]
      },
      {
        name: "recipe_items_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
