const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('supplies', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    quantity: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    unit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'measurement_units',
        key: 'id'
      }
    },
    price: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'supplier_companies',
        key: 'id'
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'supplies',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "idx_supplies_supplier_id",
        fields: [
          { name: "supplier_id" },
        ]
      },
      {
        name: "idx_supplies_unit_id",
        fields: [
          { name: "unit_id" },
        ]
      },
      {
        name: "supplies_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
