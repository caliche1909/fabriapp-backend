const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('work_areas', {
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
    tableName: 'work_areas',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "work_areas_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
