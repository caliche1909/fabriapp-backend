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
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'routes',
        key: 'id'
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
    current_visit_status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: {
          args: [['pending', 'visited']],
          msg: "El estado de visita debe ser 'pending' o 'visited'"
        }
      }
    },
    current_visit_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'store_visits',
        key: 'id'
      },
      comment: 'ID de la visita actual (si está visitada)'
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
    hasTrigger: true,
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
        name: "idx_stores_route_id",
        fields: [
          { name: "route_id" }
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
        name: "idx_stores_company_route",
        fields: [
          { name: "company_id" },
          { name: "route_id" }
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

  // Método para resetear todas las tiendas de una ruta a 'pending'
  Stores.resetRouteVisits = async function (routeId) {
    try {
      const result = await sequelize.query(
        'SELECT reset_route_visits($1) as result',
        {
          bind: [routeId],
          type: sequelize.QueryTypes.SELECT,
          raw: true
        }
      );
      return result[0].result;
    } catch (error) {
      console.error('Error al resetear visitas de ruta:', error);
      throw error;
    }
  };

  Stores.associate = (models) => {
    Stores.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    Stores.belongsTo(models.routes, {
      foreignKey: 'route_id',
      as: 'route'
    });

    Stores.belongsTo(models.store_types, {
      foreignKey: "store_type_id",
      as: "store_type"
    });

    Stores.belongsTo(models.users, {
      foreignKey: "manager_id",
      as: "manager"
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
