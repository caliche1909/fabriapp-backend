const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('products', {
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    cost: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    production_area_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'work_areas',
        key: 'id'
      }
    }
  }, {
    sequelize,
    tableName: 'products',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    hasTrigger: true,
    timestamps: true,
    indexes: [
      {
        name: "idx_products_production_area_id",
        fields: [
          { name: "production_area_id" },
        ]
      },
      {
        name: "products_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
