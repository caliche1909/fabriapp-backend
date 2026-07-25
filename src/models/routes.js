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
    route_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'route_types',
        key: 'id'
      },
      comment: 'Tipo de ruta (FK a route_types) - preventa, entrega, postventa, etc.'
    },
    working_days: {
      type: DataTypes.ARRAY(
        DataTypes.ENUM('domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado')
      ),
      allowNull: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'deleted_at',
      comment: 'Fecha de eliminación lógica. NULL = activa, TIMESTAMP = eliminada'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      field: 'deleted_by',
      comment: 'ID del usuario que eliminó la ruta (para auditoría)'
    },
  }, {
    sequelize,
    tableName: 'routes',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    hasTrigger: true,
    hooks: {
      // 👇 Método para eliminar una ruta de forma lógica (auditoría)
      beforeDestroy: (instance, options) => {
        // 🏷️ Auditoría automática: registrar quién eliminó la ruta
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          // 📝 Log para debugging si no se pasó userId
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      // 👇 Método para restaurar una ruta eliminada
      beforeRestore: (instance, options) => {
        // 🏷️ Limpiar el campo de auditoría automáticamente al restaurar
        instance.deleted_by = null;
      }
    },
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
      },
      {
        name: "idx_routes_active_only",
        fields: [
          { name: "company_id" },
          { name: "id" }
        ],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_routes_route_type",
        fields: [
          { name: "route_type_id" }
        ],
        where: {
          deleted_at: null
        }
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

    // 🔗 Relación con route_types - Una ruta pertenece a un tipo de ruta
    Routes.belongsTo(models.route_types, {
      foreignKey: 'route_type_id',
      as: 'route_type'
    });

    // 🔗 Relación MUCHOS-A-MUCHOS con tiendas vía routes_stores (única fuente de la
    // relación ruta↔tienda; la antigua 1→N `stores`/`route_id` se eliminó en Fase 7).
    Routes.hasMany(models.routes_stores, {
      foreignKey: "route_id",
      as: "route_stores"
    });
    Routes.belongsToMany(models.stores, {
      through: models.routes_stores,
      foreignKey: "route_id",
      otherKey: "store_id",
      as: "member_stores"
    });

    // 📊 Relación con StoreNoSaleReports - Una ruta puede tener muchos reportes de no-venta
    Routes.hasMany(models.store_no_sale_reports, {
      foreignKey: 'route_id',
      as: 'no_sale_reports',
      onDelete: 'SET NULL', // Si se elimina la ruta, el campo se pone NULL
      onUpdate: 'CASCADE'
    });

    // 🔗 Relación con store_visits - Una ruta puede tener muchas visitas
    Routes.hasMany(models.store_visits, {
      foreignKey: 'route_id',
      as: 'visits'
    });

    // 🔗 Relación con el usuario que eliminó la ruta (auditoría)
    Routes.belongsTo(models.users, {
      foreignKey: 'deleted_by',
      as: 'deleted_by_user'
    });
  };

  return Routes;
};


