const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const StoreVisits = sequelize.define('store_visits', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
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
          msg: "El ID del usuario es requerido"
        }
      }
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: "El ID de la tienda es requerido"
        }
      }
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // ✅ CORREGIDO: Debe permitir NULL como en el SQL
      references: {
        model: 'routes',
        key: 'id'
      }
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      validate: {
        notNull: {
          msg: "La fecha de la visita es requerida"
        },
        isDate: {
          msg: "Debe ser una fecha válida"
        }
      }
    },
    distance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: {
          msg: "La distancia es requerida"
        },
        isDecimal: {
          msg: "La distancia debe ser un número decimal"
        },
        min: {
          args: [0],
          msg: "La distancia no puede ser negativa"
        }
      }
    },
    user_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Nombre del usuario al momento de la visita (para análisis histórico)"
    },
    store_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Nombre de la tienda al momento de la visita (para análisis histórico)"
    },
    store_address: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Dirección de la tienda al momento de la visita (para análisis histórico)"
    },
    route_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Nombre de la ruta al momento de la visita (para análisis histórico)"
    },
    sale_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: {
          args: [0],
          msg: "El monto de venta no puede ser negativo"
        }
      },
      comment: "Valor de la venta realizada en esta visita (0 = solo visita sin venta)"
    }
  }, {
    sequelize,
    tableName: 'store_visits',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "store_visits_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_store_visits_user_id",
        fields: [
          { name: "user_id" }
        ]
      },
      {
        name: "idx_store_visits_store_id",
        fields: [
          { name: "store_id" }
        ]
      },
      {
        name: "idx_store_visits_route_id",
        fields: [
          { name: "route_id" }
        ]
      },
      {
        name: "idx_store_visits_date",
        fields: [
          { name: "date" }
        ]
      },
      {
        name: "idx_store_visits_user_store",
        fields: [
          { name: "user_id" },
          { name: "store_id" }
        ]
      },
      {
        name: "idx_store_visits_route_date",
        fields: [
          { name: "route_id" },
          { name: "date" }
        ]
      },
      {
        name: "idx_store_visits_store_date",
        fields: [
          { name: "store_id" },
          { name: "date" }
        ]
      },
      // 🆕 Índices adicionales que están en la tabla real
      {
        name: "idx_store_visits_analysis",
        fields: [
          { name: "store_id" },
          { name: "date" },
          { name: "sale_amount" }
        ],
        where: {
          store_id: {
            [Sequelize.Op.ne]: null
          }
        }
      },
      {
        name: "idx_store_visits_sale_amount",
        fields: [
          { name: "sale_amount" }
        ],
        where: {
          sale_amount: {
            [Sequelize.Op.gt]: 0
          }
        }
      },
      {
        name: "idx_store_visits_store_name",
        fields: [
          { name: "store_name" }
        ]
      }
    ]
  });

  StoreVisits.associate = (models) => {
    StoreVisits.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });

    StoreVisits.belongsTo(models.stores, {
      foreignKey: 'store_id',
      as: 'store'
    });

    StoreVisits.belongsTo(models.routes, {
      foreignKey: 'route_id',
      as: 'route'
    });

    // 📊 Relación con StoreNoSaleReports - Una visita puede tener UN reporte de no-venta (opcional)
    StoreVisits.hasOne(models.store_no_sale_reports, {
      foreignKey: 'visit_id',
      as: 'no_sale_report',
      onDelete: 'SET NULL', // Si se elimina la visita, el campo se pone NULL
      onUpdate: 'CASCADE'
    });
  };

  return StoreVisits;
}; 