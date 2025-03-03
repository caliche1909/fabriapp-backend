const Sequelize = require('sequelize');

module.exports = function(sequelize, DataTypes) {
  const InventorySuppliesBalance = sequelize.define('inventory_supplies_balance', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    inventory_supply_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // Solo un balance por cada insumo
      references: {
        model: 'inventory_supplies',
        key: 'id'
      },
      onDelete: 'CASCADE' // Si se elimina un insumo, también se elimina su balance
    },
    balance: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false,
      defaultValue: 0 // El balance comienza en 0
    },
    last_updated: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') // Fecha automática
    }
  }, {
    sequelize,
    tableName: 'inventory_supplies_balance',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    indexes: [
      {
        name: "idx_inventory_supplies_balance_inventory_supply",
        fields: [{ name: "inventory_supply_id" }]
      }
    ]
  });

  // Definir la relación con inventory_supplies
  InventorySuppliesBalance.associate = (models) => {
    InventorySuppliesBalance.belongsTo(models.inventory_supplies, {
      foreignKey: 'inventory_supply_id',
      as: 'inventory_supply'
    });
  };

  return InventorySuppliesBalance;
};
