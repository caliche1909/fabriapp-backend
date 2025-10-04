const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Module = sequelize.define('modules', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notNull: {
          msg: 'El nombre del módulo es requerido'
        },
        notEmpty: {
          msg: 'El nombre del módulo no puede estar vacío'
        }
      }
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: 'modules_code_key',
      validate: {
        notNull: {
          msg: 'El código del módulo es requerido'
        },
        notEmpty: {
          msg: 'El código del módulo no puede estar vacío'
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    route_path: {
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
    }
  }, {
    sequelize,
    tableName: 'modules',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  // Métodos de instancia
  Module.prototype.isActive = function () {
    return this.is_active;
  };

  // Método para obtener submódulos activos
  Module.prototype.getActiveSubmodules = function () {
    return this.getSubmodules({
      where: {
        is_active: true
      }
    });
  };

  // Relaciones
  Module.associate = function (models) {
    Module.hasMany(models.submodules, {
      foreignKey: 'module_id',
      as: 'submodules'
    });
  };

  return Module;
}; 