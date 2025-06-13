const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  return sequelize.define('measurement_units', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    abbreviation: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true
    },
    type: {
      type: DataTypes.ENUM('MASS', 'VOLUME', 'UNIT'),
      allowNull: false
    },
    conversion_factor: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 1
    },
    is_base: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
      },
      {
        name: "idx_measurement_units_type",
        fields: [{ name: "type" }]
      },
      {
        name: "measurement_units_name_unique",
        unique: true,
        fields: [{ name: "name" }]
      },
      {
        name: "measurement_units_abbreviation_unique",
        unique: true,
        fields: [{ name: "abbreviation" }]
      }
    ]
  });
};

