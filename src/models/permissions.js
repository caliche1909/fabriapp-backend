const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Permission = sequelize.define('permissions', {
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
          msg: 'El nombre del permiso es requerido'
        },
        notEmpty: {
          msg: 'El nombre del permiso no puede estar vacío'
        }
      }
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: 'permissions_code_key',
      validate: {
        notNull: {
          msg: 'El código del permiso es requerido'
        },
        notEmpty: {
          msg: 'El código del permiso no puede estar vacío'
        }
      }
    },
    submodule_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'submodules',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El submódulo es requerido'
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    sequelize,
    tableName: 'permissions',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  // Métodos de instancia
  Permission.prototype.isActive = function () {
    return this.is_active;
  };

  // Método para verificar si un rol tiene este permiso en una compañía específica
  Permission.prototype.isGrantedToRole = async function (roleId, companyId) {
    const rolePermission = await this.getRolePermissions({
      where: {
        role_id: roleId,
        company_id: companyId
      }
    });
    return rolePermission.length > 0;
  };

  // Relaciones
  Permission.associate = function (models) {
    // Pertenece a un submódulo
    Permission.belongsTo(models.submodules, {
      foreignKey: 'submodule_id',
      as: 'submodule',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });

    // Relación muchos a muchos con roles a través de role_permissions
    Permission.belongsToMany(models.roles, {
      through: models.role_permissions,
      foreignKey: 'permission_id',
      otherKey: 'role_id',
      as: 'roles'
    });

    // Relación con la tabla pivote
    Permission.hasMany(models.role_permissions, {
      foreignKey: 'permission_id',
      as: 'rolePermissions'
    });
  };

  return Permission;
}; 