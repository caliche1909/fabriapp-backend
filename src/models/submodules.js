const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Submodule = sequelize.define('submodules', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    module_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'modules',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El módulo padre es requerido'
        }
      }
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notNull: {
          msg: 'El nombre del submódulo es requerido'
        },
        notEmpty: {
          msg: 'El nombre del submódulo no puede estar vacío'
        }
      }
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: 'submodules_code_key',
      validate: {
        notNull: {
          msg: 'El código del submódulo es requerido'
        },
        notEmpty: {
          msg: 'El código del submódulo no puede estar vacío'
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    route: {
      type: DataTypes.STRING(100),
      allowNull: true,
      validate: {
        isValidRoute(value) {
          if (value && !value.startsWith('/')) {
            throw new Error('La ruta debe comenzar con "/"');
          }
        }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
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
    tableName: 'submodules',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  // Métodos de instancia
  Submodule.prototype.isActive = function () {
    return this.is_active;
  };

  // Método para obtener la ruta completa (incluyendo el módulo padre)
  Submodule.prototype.getFullRoute = async function () {
    const module = await this.getModule();
    return `${module.route_path}${this.route}`;
  };

  // Relaciones
  Submodule.associate = function (models) {
    Submodule.belongsTo(models.modules, {
      foreignKey: 'module_id',
      as: 'module'
    });

    // Aquí puedes agregar más relaciones en el futuro
    // Por ejemplo, con permisos cuando se cree ese modelo
  };

  return Submodule;
}; 