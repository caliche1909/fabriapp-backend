const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('roles', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "roles_name_key"
    }
  }, {
    sequelize,
    tableName: 'roles',
    timestamps: false, 
    underscored: true, 
    freezeTableName: true,
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "roles_name_key",
        unique: true,
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "roles_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
