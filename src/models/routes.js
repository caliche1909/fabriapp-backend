const Sequelize = require('sequelize');
module.exports = function (sequelize, DataTypes) {
  const Routes = sequelize.define('routes', {
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
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') // 🔹 Ahora guarda la fecha automáticamente
    }
  }, {
    sequelize,
    tableName: 'routes',
    timestamps: false, // ❌ No activamos `timestamps` porque queremos solo `created_at`
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    indexes: [
      {
        name: "routes_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "idx_routes_user_id",
        fields: [{ name: "user_id" }]
      }
    ]
  });

  // Asociación: Una ruta puede pertenecer a un usuario (o estar huérfana)
  Routes.associate = (models) => {
      
    // 🔹 Relación con users: Una ruta pertenece a un usuario
    Routes.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });

    // 🔹 Relación con stores: Una ruta tiene muchas tiendas
    Routes.hasMany(models.stores, {
      foreignKey: "route_id",
      as: "stores" // 👈 Este alias es el que usaremos en `include` en la consulta
  });
  };

  return Routes;
};


