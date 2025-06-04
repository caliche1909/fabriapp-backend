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
      }
    ]
  });

  // Métodos de instancia
  UserCompany.prototype.isActive = function () {
    return this.status === 'active';
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