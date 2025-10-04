const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const UserCompany = sequelize.define('user_companies', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El ID del usuario es requerido'
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
          msg: 'El ID de la compañía es requerido'
        }
      }
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
    user_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'collaborator',
      validate: {
        isIn: {
          args: [['owner', 'collaborator']],
          msg: "El tipo de usuario debe ser 'owner' o 'collaborator'"
        },
        notNull: {
          msg: 'El tipo de usuario es requerido'
        }
      },
      comment: 'Tipo de usuario: owner (propietario) o collaborator (colaborador)'
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      validate: {
        notNull: {
          msg: 'El campo is_default es requerido'
        }
      },
      comment: 'Indica si esta es la empresa por defecto para el usuario específico'
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'active',
      validate: {
        isIn: {
          args: [['active', 'inactive', 'suspended']],
          msg: "El estado debe ser 'active', 'inactive' o 'suspended'"
        }
      }
    }
  }, {
    sequelize,
    tableName: 'user_companies',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "idx_user_companies_user_id",
        fields: [{ name: "user_id" }]
      },
      {
        name: "idx_user_companies_company_id",
        fields: [{ name: "company_id" }]
      },
      {
        name: "idx_user_companies_role_id",
        fields: [{ name: "role_id" }]
      },
      {
        name: "idx_user_companies_status",
        fields: [{ name: "status" }]
      },
      {
        name: "idx_user_companies_user_type",
        fields: [{ name: "user_type" }]
      },
      {
        name: "idx_user_companies_user_company_type",
        fields: [{ name: "user_id" }, { name: "company_id" }, { name: "user_type" }]
      },
      {
        name: "idx_user_companies_is_default",
        fields: [{ name: "is_default" }]
      },
      {
        name: "idx_user_companies_user_default",
        fields: [{ name: "user_id" }, { name: "is_default" }],
        where: { is_default: true }
      }
    ]
  });

  // Métodos de instancia
  UserCompany.prototype.isActive = function () {
    return this.status === 'active';
  };

  UserCompany.prototype.isOwner = function () {
    return this.user_type === 'owner';
  };

  UserCompany.prototype.isCollaborator = function () {
    return this.user_type === 'collaborator';
  };

  UserCompany.prototype.isDefault = function () {
    return this.is_default === true;
  };

  // Método para establecer como empresa por defecto
  UserCompany.prototype.setAsDefault = async function () {
    const transaction = await sequelize.transaction();
    try {
      // Establecer todas las otras empresas del usuario como no predeterminadas
      await UserCompany.update(
        { is_default: false },
        {
          where: {
            user_id: this.user_id,
            id: { [sequelize.Sequelize.Op.ne]: this.id }
          },
          transaction
        }
      );

      // Establecer esta empresa como predeterminada
      this.is_default = true;
      await this.save({ transaction });

      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  // Métodos estáticos
  UserCompany.findOwnersByCompany = async function (companyId) {
    return await this.findAll({
      where: {
        company_id: companyId,
        user_type: 'owner',
        status: 'active'
      },
      include: [{
        model: sequelize.models.users,
        as: 'user'
      }]
    });
  };

  UserCompany.findCollaboratorsByCompany = async function (companyId) {
    return await this.findAll({
      where: {
        company_id: companyId,
        user_type: 'collaborator',
        status: 'active'
      },
      include: [{
        model: sequelize.models.users,
        as: 'user'
      }, {
        model: sequelize.models.roles,
        as: 'role'
      }]
    });
  };

  UserCompany.findCompaniesByUser = async function (userId) {
    return await this.findAll({
      where: {
        user_id: userId,
        status: 'active'
      },
      include: [{
        model: sequelize.models.companies,
        as: 'company'
      }, {
        model: sequelize.models.roles,
        as: 'role'
      }]
    });
  };

  // Relaciones
  UserCompany.associate = function (models) {
    UserCompany.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });

    UserCompany.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    UserCompany.belongsTo(models.roles, {
      foreignKey: 'role_id',
      as: 'role'
    });
  };

  return UserCompany;
}; 