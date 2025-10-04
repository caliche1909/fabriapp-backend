const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const SupplierCompanies = sequelize.define('supplier_companies', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        notNull: true
      }
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING(25),
      allowNull: true,
      unique: true
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // URL del logo del proveedor
    // Permite mostrar la imagen corporativa en la aplicación
    logo_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL del logo no es válido'
        }
      }
    },
    // Sitio web oficial del proveedor
    // Para redireccionar a más información del proveedor
    website: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL del sitio web no es válido'
        }
      }
    },
    // URL del perfil de Facebook del proveedor
    facebook_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de Facebook no es válido'
        }
      }
    },
    // URL del perfil de Instagram del proveedor
    instagram_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de Instagram no es válido'
        }
      }
    },
    // URL del perfil de X del proveedor (anteriormente Twitter)
    x_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de X no es válido'
        }
      }
    },
    // URL del perfil de LinkedIn del proveedor
    linkedin_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de LinkedIn no es válido'
        }
      }
    },
    // URL del perfil de TikTok del proveedor
    tiktok_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de TikTok no es válido'
        }
      }
    },
    // Enlace directo de WhatsApp del proveedor
    // Se genera automáticamente desde el número de teléfono
    whatsapp_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato del enlace de WhatsApp no es válido'
        }
      }
    },
    // URL del canal de YouTube del proveedor
    youtube_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'El formato de la URL de YouTube no es válido'
        }
      }
    },
    // Estado de verificación del proveedor en el sistema de calidad
    // pending: Recién creado, solo editable por la compañía creadora
    // verified: Verificado por múltiples compañías (automático cuando verification_count >= 3)
    // disputed: En disputa, requiere revisión manual
    // verified_by_fabriapp: Verificado oficialmente por administradores (estado final)
    verification: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'verified', 'disputed', 'verified_by_fabriapp']]
      }
    },
    // ID de la compañía que creó este proveedor (ownership)
    // Permite identificar quién es el "propietario" original del registro
    created_by_company_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'companies',
        key: 'id'
      }
    },
    // ID del usuario que creó este proveedor inicialmente
    // Para auditoría y trazabilidad de quién registró el proveedor
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    // ID del último usuario que modificó este proveedor
    // Se actualiza automáticamente en cada edición para trazabilidad
    last_updated_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    // Contador de verificaciones recibidas de otras compañías
    // Se incrementa cuando otras compañías "verifican" este proveedor
    // Al llegar a 10+ cambia automáticamente el estado a 'verified'
    verification_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    }
  }, {
    sequelize,
    tableName: 'supplier_companies',
    schema: 'public',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "supplier_companies_pkey",
        unique: true,
        fields: [{ name: "id" }]
      },
      {
        name: "idx_supplier_companies_name",
        unique: true,
        fields: [{ name: "name" }]
      },
      {
        name: "idx_supplier_companies_email",
        unique: true,
        fields: [{ name: "email" }]
      },
      {
        name: "idx_supplier_companies_phone",
        unique: true,
        fields: [{ name: "phone" }]
      },
      {
        name: "idx_supplier_companies_country_state_city",
        fields: [
          { name: "country" },
          { name: "state" },
          { name: "city" }
        ]
      },
      // Nuevos índices para optimizar consultas de verificación y ownership
      {
        name: "idx_supplier_companies_verification",
        fields: [{ name: "verification" }]
      },
      {
        name: "idx_supplier_companies_created_by_company",
        fields: [{ name: "created_by_company_id" }]
      },
      {
        name: "idx_supplier_companies_verification_count",
        fields: [{ name: "verification_count" }]
      }
    ]
  });

  // Método de instancia para obtener la dirección completa
  SupplierCompanies.prototype.getFullAddress = function () {
    const parts = [this.address, this.city, this.state, this.country];
    return parts.filter(Boolean).join(', ');
  };

  // Método de instancia para obtener todas las redes sociales disponibles
  SupplierCompanies.prototype.getSocialMedia = function () {
    const socialMedia = {};

    if (this.website) socialMedia.website = this.website;
    if (this.facebook_url) socialMedia.facebook = this.facebook_url;
    if (this.instagram_url) socialMedia.instagram = this.instagram_url;
    if (this.x_url) socialMedia.x = this.x_url;
    if (this.linkedin_url) socialMedia.linkedin = this.linkedin_url;
    if (this.tiktok_url) socialMedia.tiktok = this.tiktok_url;
    if (this.youtube_url) socialMedia.youtube = this.youtube_url;
    if (this.whatsapp_url) socialMedia.whatsapp = this.whatsapp_url; // ✅ CORREGIDO

    return socialMedia;
  };

  // Método de instancia para verificar si tiene redes sociales
  SupplierCompanies.prototype.hasSocialMedia = function () {
    return !!(this.website || this.facebook_url || this.instagram_url || this.x_url ||
      this.linkedin_url || this.tiktok_url || this.youtube_url || this.whatsapp_url);
  };

  // Método de instancia para generar enlace de WhatsApp desde el teléfono
  SupplierCompanies.prototype.getWhatsAppLink = function (message = '') {
    if (!this.phone) return null;

    // Limpiar el número: remover guiones, espacios, paréntesis
    const cleanPhone = this.phone.replace(/[-\s()]/g, '');

    // Generar enlace de WhatsApp
    const encodedMessage = encodeURIComponent(message);
    return `https://wa.me/${cleanPhone}${message ? `?text=${encodedMessage}` : ''}`;
  };


  // Método de instancia para obtener el número de WhatsApp formateado
  SupplierCompanies.prototype.getWhatsAppNumber = function () {
    return this.phone; // El teléfono ya está en formato internacional
  };

  // Método de instancia para verificar si el proveedor puede ser editado
  SupplierCompanies.prototype.canBeEdited = function (companyId, isAdmin = false) {
    // Los administradores siempre pueden editar
    if (isAdmin) return true;

    // Si está verificado oficialmente por FabriApp, no se puede editar
    if (this.verification === 'verified_by_fabriapp') return false;

    // Si está en estado pending, solo la compañía creadora puede editar
    if (this.verification === 'pending') {
      return this.created_by_company_id === companyId;
    }

    // Si está verified o disputed, nadie puede editar (solo admins)
    return false;
  };

  // Método de instancia para verificar si una compañía puede verificar este proveedor
  SupplierCompanies.prototype.canBeVerified = function (companyId) {
    // No puede verificar su propio proveedor
    if (this.created_by_company_id === companyId) return false;

    // Solo se pueden verificar proveedores en estado pending o verified
    return ['pending', 'verified'].includes(this.verification);
  };

  // Definir las asociaciones
  SupplierCompanies.associate = (models) => {
    // Relación directa con insumos (uno a muchos)
    SupplierCompanies.hasMany(models.inventory_supplies, {
      foreignKey: 'supplier_id',
      as: 'supplies'
    });

    // Relación con la compañía que creó el proveedor
    SupplierCompanies.belongsTo(models.companies, {
      foreignKey: 'created_by_company_id',
      as: 'creator_company'
    });

    // Relación con el usuario que creó el proveedor
    SupplierCompanies.belongsTo(models.users, {
      foreignKey: 'created_by_user_id',
      as: 'creator_user'
    });

    // Relación con el último usuario que actualizó
    SupplierCompanies.belongsTo(models.users, {
      foreignKey: 'last_updated_by_user_id',
      as: 'last_updater_user'
    });

    // Relación con las verificaciones recibidas
    SupplierCompanies.hasMany(models.supplier_verifications, {
      foreignKey: 'supplier_id',
      as: 'verifications',
      onDelete: 'CASCADE'
    });
  };

  return SupplierCompanies;
};
