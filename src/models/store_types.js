const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('store_types', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'store_types',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "store_types_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
