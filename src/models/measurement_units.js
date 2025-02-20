const Sequelize = require('sequelize');

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('measurement_units', {
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
    abbreviation: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    conversion_factor: { // 🔹 Nueva columna agregada
      type: DataTypes.DECIMAL(10,2),
      allowNull: false,
      defaultValue: 1 // 🔹 Igual que en la base de datos
    }
  }, {
    sequelize,
    tableName: 'measurement_units',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    indexes: [
      {
        name: "measurement_units_pkey",
        unique: true,
        fields: [{ name: "id" }]
      }
    ]
  });
};

