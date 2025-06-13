const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const RolePermission = sequelize.define('role_permissions', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'roles',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El rol es requerido'
        }
      }
    },
    permission_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'permissions',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El permiso es requerido'
        }
      }
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'companies',
        key: 'id'
      },
      validate: {
        async isValidCompanyRole(value) {
          const role = await sequelize.models.roles.findByPk(this.role_id);
          if (!role) throw new Error('Rol no encontrado');
          
          if (role.is_global && value !== null) {
            throw new Error('Los roles globales no pueden tener una compañía asignada');
          }
          if (!role.is_global && value === null) {
            throw new Error('Los roles no globales deben tener una compañía asignada');
          }
        }
      }
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
    tableName: 'role_permissions',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "idx_role_permissions_role",
        fields: [{ name: "role_id" }]
      },
      {
        name: "idx_role_permissions_company",
        fields: [{ name: "company_id" }]
      },
      {
        name: "idx_role_permissions_global",
        fields: [{ name: "role_id" }],
        where: { company_id: null }
      }
    ]
  });

  // Relaciones
  RolePermission.associate = function (models) {
    // Pertenece a un rol
    RolePermission.belongsTo(models.roles, {
      foreignKey: 'role_id',
      as: 'role'
    });

    // Pertenece a un permiso
    RolePermission.belongsTo(models.permissions, {
      foreignKey: 'permission_id',
      as: 'permission'
    });

    // Pertenece a una compañía
    RolePermission.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });
  };

  // Método para verificar si existe una asignación específica
  RolePermission.prototype.exists = async function (roleId, permissionId, companyId) {
    return await RolePermission.findOne({
      where: {
        role_id: roleId,
        permission_id: permissionId,
        company_id: companyId
      }
    }) !== null;
  };

  return RolePermission;
}; 