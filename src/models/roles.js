const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Role = sequelize.define('roles', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notEmpty: true,
        notNull: true
      }
    },
    label: {
      type: DataTypes.STRING(100),
      allowNull: true,
      validate: {
        len: {
          args: [2, 100],
          msg: 'La etiqueta debe tener entre 2 y 100 caracteres'
        }
      },
      comment: 'Etiqueta amigable para mostrar en la interfaz de usuario'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 500],
          msg: 'La descripción no puede exceder 500 caracteres'
        }
      },
      comment: 'Descripción detallada del rol y sus responsabilidades'
    },
    is_global: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
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
          if (this.is_global && value !== null) {
            throw new Error('Los roles globales no pueden tener una compañía asignada');
          }
          if (!this.is_global && value === null) {
            throw new Error('Los roles no globales deben tener una compañía asignada');
          }
        }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Indica si el rol está activo o ha sido deshabilitado'
    }
  }, {
    sequelize,
    tableName: 'roles',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      beforeCreate: async (role, options) => {
        // Normalizar name y label antes de crear
        if (role.name) {
          role.name = Role.normalizeName(role.name);
        }
        if (role.label) {
          role.label = Role.normalizeLabel(role.label);
        }
      },
      beforeUpdate: async (role, options) => {
        const oldRole = await Role.findByPk(role.id);
        if (oldRole.is_global) {
          if (oldRole.name !== role.name) {
            throw new Error('No se puede modificar el nombre de roles globales');
          }
          if (oldRole.is_global !== role.is_global) {
            throw new Error('No se puede modificar el estado global de un rol global');
          }
        }

        // Normalizar name y label antes de actualizar (solo para roles no globales)
        if (!oldRole.is_global) {
          if (role.name) {
            role.name = Role.normalizeName(role.name);
          }
          if (role.label) {
            role.label = Role.normalizeLabel(role.label);
          }
        }
      },
      beforeDestroy: async (role, options) => {
        if (role.is_global) {
          throw new Error('No se pueden eliminar roles globales');
        }
      }
    },
    indexes: [
      {
        name: "roles_name_company_unique",
        unique: true,
        fields: [
          { name: "name" },
          { name: "company_id" }
        ]
      },
      {
        name: "idx_roles_name",
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "idx_roles_is_global",
        fields: [
          { name: "is_global" },
        ]
      },
      {
        name: "idx_roles_company_id",
        fields: [
          { name: "company_id" },
        ]
      },
      {
        name: "idx_roles_label",
        fields: [
          { name: "label" },
        ]
      }
    ]
  });

  // Métodos estáticos para normalización
  Role.normalizeName = function (roleName) {
    // Convertir a mayúsculas, quitar espacios y reemplazar espacios con guiones bajos
    return roleName
      .trim()                    // Quitar espacios al inicio y final
      .toUpperCase()             // Convertir a mayúsculas
      .replace(/\s+/g, '_');     // Reemplazar espacios con guion bajo
  };

  Role.normalizeLabel = function (roleLabel) {
    // Capitalizar primera letra y quitar espacios al inicio/final
    const trimmed = roleLabel.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  };

  // Método estático para obtener roles globales
  Role.getGlobalRoles = function () {
    return this.findAll({
      where: {
        is_global: true
      }
    });
  };

  // Método de instancia para verificar si un rol es global
  Role.prototype.isGlobal = function () {
    return this.is_global;
  };

  // Método para obtener roles por compañía
  Role.getCompanyRoles = function (companyId) {
    return this.findAll({
      where: {
        company_id: companyId
      }
    });
  };

  // Relaciones
  Role.associate = function (models) {
    // Relación con la compañía
    Role.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    // Relación con usuarios a través de user_companies
    Role.hasMany(models.user_companies, {
      foreignKey: 'role_id',
      as: 'userCompanies'
    });

    // Relación muchos a muchos con permisos
    Role.belongsToMany(models.permissions, {
      through: models.role_permissions,
      foreignKey: 'role_id',
      otherKey: 'permission_id',
      as: 'permissions'
    });

    // Relación con la tabla pivote de permisos
    Role.hasMany(models.role_permissions, {
      foreignKey: 'role_id',
      as: 'rolePermissions'
    });
  };

  return Role;
};
