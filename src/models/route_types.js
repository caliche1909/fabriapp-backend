const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const RouteTypes = sequelize.define('route_types', {
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
          msg: "El nombre del tipo de ruta es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'companies',
        key: 'id'
      },
      comment: 'ID de la compañía (NULL para tipos globales del sistema)'
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: false,
      defaultValue: '#1976d2',
      validate: {
        is: {
          args: /^#[0-9A-Fa-f]{6}$/,
          msg: "El color debe estar en formato hexadecimal (ej: #1976d2)"
        }
      }
    },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: "El orden de visualización no puede ser negativo"
        }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    is_global: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true=tipo de sistema (para todas las compañías), false=tipo personalizado de una compañía'
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de eliminación lógica. NULL = activo, TIMESTAMP = eliminado'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que eliminó el tipo de ruta (para auditoría)'
    }
  }, {
    sequelize,
    tableName: 'route_types',
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
      // 👇 Método para eliminar un tipo de ruta de forma lógica (auditoría)
      beforeDestroy: (instance, options) => {
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      // 👇 Método para restaurar un tipo de ruta eliminado
      beforeRestore: (instance, options) => {
        instance.deleted_by = null;
      }
    },
    indexes: [
      {
        name: "route_types_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_route_types_company",
        fields: [
          { name: "company_id" },
          { name: "is_active" }
        ],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_route_types_display_order",
        fields: [
          { name: "company_id" },
          { name: "display_order" },
          { name: "name" }
        ],
        where: {
          deleted_at: null,
          is_active: true
        }
      },
      {
        name: "idx_route_types_name",
        fields: [
          { name: sequelize.fn('LOWER', sequelize.col('name')) }
        ],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_unique_route_type_name_per_company",
        unique: true,
        fields: [
          { name: "company_id" },
          { name: sequelize.fn('LOWER', sequelize.col('name')) }
        ],
        where: {
          company_id: { [sequelize.Sequelize.Op.ne]: null }
        }
      }
    ]
  });

  RouteTypes.associate = (models) => {
    // 🔗 Relación con companies (opcional, para tipos personalizados por compañía)
    RouteTypes.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    // 🔗 Relación con routes - Un tipo de ruta puede tener muchas rutas
    RouteTypes.hasMany(models.routes, {
      foreignKey: 'route_type_id',
      as: 'routes'
    });

    // 🔗 Relación con el usuario que eliminó el tipo (auditoría)
    RouteTypes.belongsTo(models.users, {
      foreignKey: 'deleted_by',
      as: 'deleted_by_user'
    });
  };

  return RouteTypes;
};
