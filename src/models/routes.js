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
      allowNull: false,
      validate: {
        notNull: {
          msg: "El nombre de la ruta es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: "El ID de la compañía es requerido"
        }
      }
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    working_days: {
      type: DataTypes.ARRAY(
        DataTypes.ENUM('domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado')
      ),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'routes',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "routes_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_routes_company_id",
        fields: [
          { name: "company_id" }
        ]
      },
      {
        name: "idx_routes_user_id",
        fields: [
          { name: "user_id" }
        ]
      },
      {
        name: "idx_routes_company_user",
        fields: [
          { name: "company_id" },
          { name: "user_id" }
        ]
      },
      {
        name: "idx_routes_name",
        fields: [
          { name: "name" }
        ]
      }
    ]
  });

  Routes.associate = (models) => {
    Routes.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    Routes.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'seller'
    });

    Routes.hasMany(models.stores, {
      foreignKey: "route_id",
      as: "stores"
    });
  };

  return Routes;
};


