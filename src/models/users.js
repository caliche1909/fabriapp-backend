const Sequelize = require('sequelize');
const bcrypt = require('bcrypt');

module.exports = function (sequelize, DataTypes) {
  const Users = sequelize.define('users', {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.literal('uuid_generate_v4()'),
      allowNull: false,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "users_email_key",
      validate: {
        isEmail: {
          msg: "El formato del email no es válido"
        },
        notNull: {
          msg: "El email es requerido"
        },
        notEmpty: {
          msg: "El email no puede estar vacío"
        }
      }
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: {
          msg: "La contraseña es requerida"
        },
        notEmpty: {
          msg: "La contraseña no puede estar vacía"
        },
        len: {
          args: [6, 100],
          msg: "La contraseña debe tener entre 6 y 100 caracteres"
        }
      }
    },
    first_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notNull: {
          msg: "El nombre es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    last_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notNull: {
          msg: "El apellido es requerido"
        },
        notEmpty: {
          msg: "El apellido no puede estar vacío"
        }
      }
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: "users_phone_key",
      validate: {
        is: {
          args: /^[\d-]{9,19}$/,
          msg: "Numero de telefono invalido"
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
          msg: "El rol es requerido"
        }
      }
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'active',
      validate: {
        isIn: {
          args: [['active', 'inactive', 'blocked']],
          msg: "El estado debe ser 'active', 'inactive' o 'blocked'"
        }
      }
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    last_login: {
      type: DataTypes.DATE,
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
    tableName: 'users',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "idx_users_role_id",
        fields: [{ name: "role_id" }]
      },
      {
        name: "idx_users_status",
        fields: [{ name: "status" }]
      },
      {
        name: "idx_users_email_status",
        fields: [{ name: "email" }, { name: "status" }]
      },
      {
        name: "users_email_key",
        unique: true,
        fields: [{ name: "email" }]
      },
      {
        name: "users_phone_key",
        unique: true,
        fields: [{ name: "phone" }]
      }
    ],
    hooks: {
      beforeSave: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    }
  });

  // Método para verificar contraseña
  Users.prototype.validatePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
  };

  // Método para obtener el nombre completo
  Users.prototype.getFullName = function () {
    return `${this.first_name} ${this.last_name}`;
  };

  // Método para verificar si el usuario está activo
  Users.prototype.isActive = function () {
    return this.status === 'active';
  };

  // Método para actualizar último login
  Users.prototype.updateLastLogin = async function () {
    this.last_login = new Date();
    await this.save();
  };

  // Método para obtener todas las compañías del usuario (propias y asignadas)
  Users.prototype.getAllCompanies = async function() {
    const { owned_companies } = await Users.findByPk(this.id, {
      include: [{
        model: sequelize.models.companies,
        as: 'owned_companies'
      }]
    });

    const { company_assignments } = await Users.findByPk(this.id, {
      include: [{
        model: sequelize.models.user_companies,
        as: 'company_assignments',
        include: [{
          model: sequelize.models.companies,
          as: 'company'
        }]
      }]
    });

    const assignedCompanies = company_assignments.map(uc => uc.company);
    return [...owned_companies, ...assignedCompanies];
  };

  // Relaciones
  Users.associate = (models) => {
    Users.belongsTo(models.roles, {
      foreignKey: 'role_id',
      as: 'role'
    });

    Users.hasMany(models.supplies_stock, {
      foreignKey: 'user_id',
      as: 'movements'
    });

    Users.hasMany(models.routes, {
      foreignKey: 'user_id',
      as: 'routes'
    });

    // Relación con companies como propietario
    Users.hasMany(models.companies, {
      foreignKey: 'owner_id',
      as: 'owned_companies'
    });

    // Relación con user_companies
    Users.hasMany(models.user_companies, {
      foreignKey: 'user_id',
      as: 'company_assignments'
    });

    // Relación muchos a muchos con companies a través de user_companies
    Users.belongsToMany(models.companies, {
      through: models.user_companies,
      foreignKey: 'user_id',
      otherKey: 'company_id',
      as: 'assigned_companies'
    });
  };

  return Users;
};
