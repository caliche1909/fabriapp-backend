const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('sales', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    sale_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    total_amount: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    payment_method_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'payment_methods',
        key: 'id'
      }
    }
  }, {
    sequelize,
    tableName: 'sales',
    schema: 'public',
    hasTrigger: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_sales_payment_method_id",
        fields: [
          { name: "payment_method_id" },
        ]
      },
      {
        name: "idx_sales_store_id",
        fields: [
          { name: "store_id" },
        ]
      },
      {
        name: "idx_sales_user_id",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "sales_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
