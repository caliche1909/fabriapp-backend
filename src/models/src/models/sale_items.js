const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('sale_items', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    sale_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'sales',
        key: 'id'
      }
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id'
      }
    },
    quantity: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    unit_price: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    total_price: {
      type: DataTypes.DECIMAL,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'sale_items',
    schema: 'public',
    hasTrigger: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_sale_items_product_id",
        fields: [
          { name: "product_id" },
        ]
      },
      {
        name: "idx_sale_items_sale_id",
        fields: [
          { name: "sale_id" },
        ]
      },
      {
        name: "sale_items_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
