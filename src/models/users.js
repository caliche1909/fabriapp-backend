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
    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: {
          msg: "Debe ser una URL válida"
        }
      },
      comment: 'URL de la imagen de perfil del usuario almacenada en la web'
    },
    image_public_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Public ID de Cloudinary para la imagen de perfil del usuario'
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
    require_geolocation: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si el usuario requiere tracking de geolocalización en tiempo real'
    },
    session_status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'offline',
      validate: {
        isIn: {
          args: [['offline', 'online']],
          msg: "El estado de sesión debe ser 'offline' u 'online'"
        }
      },
      comment: 'Estado actual de la sesión del usuario'
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
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
      },
      {
        name: "idx_users_session_status",
        fields: [{ name: "session_status" }]
      },
      {
        name: "idx_users_image_url",
        fields: [{ name: "image_url" }],
        where: {
          image_url: { [Sequelize.Op.ne]: null }
        }
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

  // Método para activar geolocalización
  Users.prototype.enableGeolocation = async function () {
    this.require_geolocation = true;
    await this.save();
  };

  // Método para desactivar geolocalización
  Users.prototype.disableGeolocation = async function () {
    this.require_geolocation = false;
    await this.save();
  };

  // Método para verificar si tiene geolocalización activa
  Users.prototype.hasActiveGeolocation = function () {
    return this.require_geolocation === true;
  };

  // Método para actualizar imagen de perfil
  Users.prototype.updateProfileImage = async function (imageUrl) {
    this.image_url = imageUrl;
    await this.save();
  };

  // Método para eliminar imagen de perfil
  Users.prototype.removeProfileImage = async function () {
    this.image_url = null;
    await this.save();
  };

  // Método para verificar si tiene imagen de perfil
  Users.prototype.hasProfileImage = function () {
    return this.image_url !== null && this.image_url !== '';
  };

  // Método para obtener URL de imagen o imagen por defecto
  Users.prototype.getProfileImageUrl = function (defaultImageUrl = null) {
    return this.image_url || defaultImageUrl;
  };

  // Método para obtener todas las compañías del usuario (propias y asignadas)
  Users.prototype.getAllCompanies = async function () {
    const userCompaniesData = await sequelize.models.user_companies.findAll({
      where: {
        user_id: this.id,
        status: 'active'
      },
      include: [
        {
          model: sequelize.models.companies,
          as: 'company'
        },
        {
          model: sequelize.models.roles,
          as: 'role'
        }
      ]
    });

    return userCompaniesData.map(userCompany => ({
      ...userCompany.company.toJSON(),
      userType: userCompany.user_type, // 'owner' o 'collaborator'
      userRole: userCompany.role ? userCompany.role.name : 'COLLABORATOR'
    }));
  };

  // Relaciones
  Users.associate = (models) => {
    Users.hasMany(models.supplies_stock, {
      foreignKey: 'user_id',
      as: 'movements'
    });

    Users.hasMany(models.routes, {
      foreignKey: 'user_id',
      as: 'routes'
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

    // Relación con user_current_position
    Users.hasOne(models.user_current_position, {
      foreignKey: 'user_id',
      as: 'current_position'
    });

    // Relación con password_resets
    Users.hasMany(models.password_resets, {
      foreignKey: 'user_id',
      as: 'password_resets'
    });

    // 📊 Relación con StoreNoSaleReports - Un usuario puede crear muchos reportes de no-venta
    Users.hasMany(models.store_no_sale_reports, {
      foreignKey: 'user_id',
      as: 'no_sale_reports',
      onDelete: 'RESTRICT', // No se puede eliminar un usuario con reportes
      onUpdate: 'CASCADE'
    });

    // 💳 Relación con PaymentMethods para auditoría de eliminación
    Users.hasMany(models.payment_methods, {
      foreignKey: 'deleted_by',
      as: 'deleted_payment_methods',
      onDelete: 'SET NULL', // Si se elimina el usuario, se pone NULL en deleted_by
      onUpdate: 'NO ACTION'
    });
  };

  return Users;
};
