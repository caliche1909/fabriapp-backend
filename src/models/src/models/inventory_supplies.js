const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('inventory_supplies', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
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
    }
  }, {
    sequelize,
    tableName: 'inventory_supplies',
    schema: 'public',
    hasTrigger: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_inventory_supplies_supply_id",
        fields: [
          { name: "supply_id" },
        ]
      },
      {
        name: "inventory_supplies_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
