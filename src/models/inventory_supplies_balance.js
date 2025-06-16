const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
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
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      onDelete: 'CASCADE', // Si se elimina una compañía, también se eliminan sus balances
      comment: 'ID de la compañía propietaria del insumo. Desnormalización para optimizar consultas de balance por compañía. Se sincroniza automáticamente con inventory_supplies.company_id'
    },
    balance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0, // El balance comienza en 0
      validate: {
        min: 0 // Ensures balance cannot be negative
      }
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
      },
      {
        name: "idx_inventory_supplies_balance_company_id",
        fields: [{ name: "company_id" }]
      },
      {
        name: "idx_inventory_supplies_balance_company_balance",
        fields: [{ name: "company_id" }, { name: "balance" }]
      }
    ]
  });

  // Definir las relaciones
  InventorySuppliesBalance.associate = (models) => {
    // Relación con inventory_supplies
    InventorySuppliesBalance.belongsTo(models.inventory_supplies, {
      foreignKey: 'inventory_supply_id',
      as: 'inventory_supply'
    });

    // Relación directa con companies (nueva)
    InventorySuppliesBalance.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });
  };

  return InventorySuppliesBalance;
};
