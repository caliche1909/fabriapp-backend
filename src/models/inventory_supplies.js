const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 1. Definir el modelo y asignarlo a una variable
  const InventorySupplies = sequelize.define('inventory_supplies', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,  // 🔹 Corregido
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    packaging_type: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    packaging_weight: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      }
    },
    packaging_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'measurement_units',
        key: 'id'
      },
      onDelete: 'RESTRICT' // 🔹 Igual que en la BD
    },
    packaging_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    portions: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    portion_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'measurement_units',
        key: 'id'
      },
      onDelete: 'RESTRICT' // 🔹 Igual que en la BD
    },
    portion_price: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true
    },
    total_quantity_gr_ml_und: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'supplier_companies',
        key: 'id'
      },
      onDelete: 'SET NULL' // 🔹 Igual que en la BD
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'inventory_supplies',
    timestamps: false,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    hasTrigger: true,
    indexes: [
      {
        name: "idx_inventory_supplies_supplier_id",
        fields: [{ name: "supplier_id" }]
      },
      {
        name: "idx_inventory_supplies_packaging_unit",
        fields: [{ name: "packaging_unit_id" }]
      },
      {
        name: "idx_inventory_supplies_portion_unit",
        fields: [{ name: "portion_unit_id" }]
      },
      {
        name: "inventory_supplies_pkey",
        unique: true,
        fields: [{ name: "id" }]
      }
    ]
  });

  // 2. Agregar las asociaciones
  InventorySupplies.associate = (models) => {
    InventorySupplies.belongsTo(models.measurement_units, {
      foreignKey: 'packaging_unit_id',
      as: 'packaging_unit'
    });
    InventorySupplies.belongsTo(models.measurement_units, {
      foreignKey: 'portion_unit_id',
      as: 'portion_unit'
    });
    InventorySupplies.belongsTo(models.supplier_companies, {
      foreignKey: 'supplier_id',
      as: 'supplier'
    });
  };

  // 3. Retornar el modelo configurado
  return InventorySupplies;
};
