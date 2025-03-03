const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('payment_methods', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'payment_methods',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "payment_methods_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
