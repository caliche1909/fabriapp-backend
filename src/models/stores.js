const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const Stores = sequelize.define('stores', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notNull: {
          msg: "El nombre de la tienda es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: {
          msg: "La dirección es requerida"
        },
        notEmpty: {
          msg: "La dirección no puede estar vacía"
        }
      }
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
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
          msg: "El ID de la compañía es requerido"
        }
      }
    },
    manager_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    store_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'store_types',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: "El tipo de tienda es requerido"
        }
      }
    },
    ubicacion: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: true
    },
    opening_time: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    closing_time: {
      type: DataTypes.STRING(50),
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
    neighborhood: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de eliminación lógica. NULL = activa, TIMESTAMP = eliminada'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que eliminó la tienda (para auditoría)'
    }
  }, {
    sequelize,
    tableName: 'stores',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    hasTrigger: true,
    hooks: {
      // 👇 Metodo para eliminar una tienda de forma logica sirve para auditoria
      beforeDestroy: (instance, options) => {
        // 🏷️ Auditoría automática: registrar quién eliminó la tienda
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          // 📝 Log para debugging si no se pasó userId
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      // 👇 Metodo para restaurar una tienda eliminada
      beforeRestore: (instance, options) => {
        // 🏷️ Limpiar el campo de auditoría automáticamente al restaurar
        instance.deleted_by = null;
      }
    },
    indexes: [
      {
        name: "stores_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_stores_company_id",
        fields: [
          { name: "company_id" }
        ]
      },
      {
        name: "idx_stores_manager_id",
        fields: [
          { name: "manager_id" }
        ]
      },
      {
        name: "idx_stores_store_type_id",
        fields: [
          { name: "store_type_id" }
        ]
      },
      {
        name: "idx_stores_name",
        fields: [
          { name: "name" }
        ]
      },
      {
        name: "idx_stores_ubicacion",
        using: 'GIST',
        fields: [
          { name: "ubicacion" }
        ]
      },
      {
        name: "idx_stores_company_address_unique",
        unique: true,
        fields: [
          { name: "company_id" },
          { name: "address" }
        ]
      }
    ]
  });

  Stores.prototype.setUbicacion = function (lat, lng) {
    return sequelize.fn('ST_SetSRID',
      sequelize.fn('ST_MakePoint', lng, lat),
      4326
    );
  };

  Stores.prototype.getLatitud = function () {
    if (this.ubicacion) {
      return sequelize.fn('ST_Y', this.ubicacion);
    }
    return null;
  };

  Stores.prototype.getLongitud = function () {
    if (this.ubicacion) {
      return sequelize.fn('ST_X', this.ubicacion);
    }
    return null;
  };

  Stores.findByProximity = function (lat, lng, radiusKm = 5) {
    const punto = sequelize.fn('ST_SetSRID',
      sequelize.fn('ST_MakePoint', lng, lat),
      4326
    );

    return this.findAll({
      where: sequelize.where(
        sequelize.fn('ST_DWithin',
          sequelize.col('ubicacion'),
          punto,
          radiusKm / 111.32
        ),
        true
      ),
      attributes: {
        include: [
          [sequelize.fn('ST_Distance',
            sequelize.col('ubicacion'),
            punto
          ) * 111320, 'distancia_metros']
        ]
      },
      order: [[sequelize.literal('distancia_metros'), 'ASC']]
    });
  };

  Stores.associate = (models) => {
    Stores.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    // 🔗 Relación MUCHOS-A-MUCHOS con rutas vía routes_stores (única fuente de la
    // relación tienda↔ruta; la antigua 1→1 `route`/`route_id` se eliminó en Fase 7).
    Stores.hasMany(models.routes_stores, {
      foreignKey: 'store_id',
      as: 'store_routes'
    });
    Stores.belongsToMany(models.routes, {
      through: models.routes_stores,
      foreignKey: 'store_id',
      otherKey: 'route_id',
      as: 'member_routes'
    });

    Stores.belongsTo(models.store_types, {
      foreignKey: "store_type_id",
      as: "store_type"
    });

    Stores.belongsTo(models.users, {
      foreignKey: "manager_id",
      as: "manager"
    });

    // 🔗 Relación con el usuario que eliminó la tienda (auditoría)
    Stores.belongsTo(models.users, {
      foreignKey: 'deleted_by',
      as: 'deleted_by_user'
    });

    // 🔗 Relación inversa: una tienda puede tener muchas visitas históricas
    Stores.hasMany(models.store_visits, {
      foreignKey: 'store_id',
      as: 'visits',
      onDelete: 'RESTRICT', // No se puede eliminar una tienda con visitas
      onUpdate: 'CASCADE'
    });

    Stores.hasMany(models.store_images, {
      foreignKey: 'store_id',
      as: 'images'
    });

    // 🚫 Relación con StoreNoSaleReports - Una tienda puede tener muchos reportes de no-venta
    Stores.hasMany(models.store_no_sale_reports, {
      foreignKey: 'store_id',
      as: 'no_sale_reports',
      onDelete: 'RESTRICT', // No se puede eliminar una tienda con reportes
      onUpdate: 'CASCADE'
    });
  };

  return Stores;
};
