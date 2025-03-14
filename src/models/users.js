const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Users = sequelize.define('users', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "users_email_key"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    role_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'roles',
        key: 'id'
      }
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'active',
      validate: {
        isIn: [['active', 'inactive']]
      }
    },
  }, {
    sequelize,
    tableName: 'users',
    timestamps: true, // 🔹 Ahora mantiene los timestamps
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    hasTrigger: true,
    indexes: [
      {
        name: "idx_users_role_id",
        fields: [{ name: "role_id" }]
      },
      {
        name: "users_email_key",
        unique: true,
        fields: [{ name: "email" }]
      },
      {
        name: "users_pkey",
        unique: true,
        fields: [{ name: "id" }]
      }
    ]
  });

  // 🔹 Relación: Un usuario puede registrar muchos movimientos de stock
  Users.associate = (models) => {
    Users.hasMany(models.supplies_stock, {
      foreignKey: 'user_id',
      as: 'movements'
    });

    Users.belongsTo(models.roles, {
      foreignKey: 'role_id',
      as: 'role'
    });

    Users.hasMany(models.routes, {
      foreignKey: 'user_id',
      as: 'routes'
    });
  };

  return Users;
};
