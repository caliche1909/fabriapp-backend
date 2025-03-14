const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const SuppliesStock = sequelize.define('supplies_stock', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    inventory_supply_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'inventory_supplies', // Relación con el catálogo de insumos
        key: 'id'
      },
      onDelete: 'CASCADE' // Si se elimina un insumo, se eliminan sus registros de stock
    },
    quantity_change_gr_ml_und: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    transaction_type: {
      type: DataTypes.ENUM('ENTRADA', 'SALIDA'), // Solo acepta estos valores
      allowNull: false
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') // Fecha automática
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users', // Relación con la tabla de usuarios
        key: 'id'
      },
      onDelete: 'SET NULL' // Si se elimina el usuario, el registro no se borra, pero su ID se pone en NULL
    },
  }, {
    sequelize,
    tableName: 'supplies_stock',
    timestamps: false,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    indexes: [
      {
        name: "idx_supplies_stock_inventory_supply",
        fields: [{ name: "inventory_supply_id" }]
      },
      {
        name: "idx_supplies_stock_transaction_type",
        fields: [{ name: "transaction_type" }]
      }
    ]
  });

  // Definir la relación con inventory_supplies
  SuppliesStock.associate = (models) => {

    SuppliesStock.belongsTo(models.inventory_supplies, {
      foreignKey: 'inventory_supply_id',
      as: 'inventory_supply'
    });

    SuppliesStock.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });
  };

  return SuppliesStock;
};


