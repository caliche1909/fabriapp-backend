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
      // Nullable: una parada 'pending' aún no tiene distancia medida; se registra
      // al marcarse 'visited'. (Cambiado por la migración 20260715180414.)
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
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
    },
    // 🔄 Ciclo de vida de la parada (agregado por la migración 20260715180414).
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: {
          args: [['pending', 'visited', 'completed']],
          msg: "El estado debe ser 'pending', 'visited' o 'completed'"
        }
      },
      comment: "Ciclo de vida de la parada: 'pending' | 'visited' | 'completed'"
    },
    visit_day: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Día hábil del negocio (TZ America/Bogota) al que pertenece la parada'
    },
    arrived_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Momento en que la parada pasó a 'visited' (llegada real)"
    },
    optimized_seq: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Orden del recorrido optimizado del día (solo pendientes; NULL = sin orden)'
    },
    visit_type: {
      type: DataTypes.ENUM('in-route', 'occasional'),
      allowNull: false,
      defaultValue: 'in-route',
      // 'in-route'   → nació de la membresía de la ruta (iniciar jornada o ajuste).
      // 'occasional' → la agregó el vendedor sobre la marcha para una venta ocasional; su
      //                tienda NO pertenece a la ruta, y esta marca es lo que impide que el
      //                diagnóstico de "Ajustar" la confunda con una parada huérfana y la borre.
      comment: 'Origen de la parada: in-route (nació de la ruta) | occasional (venta ocasional)'
    },
    // 🔁 Idempotencia del MARCADO. La parada la crea `startRoute`; este campo identifica la
    // operación del cliente que la pasó de 'pending' a 'visited', para que un reintento no se
    // confunda con "otra persona la cerró" (que también responde 409, pero significa otra cosa).
    client_operation_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'UUID de la operación del cliente que marcó la parada (idempotencia). NULL = marcada en vivo o antes del offline.'
    },
    // 🕗 Ojo: `created_at` aquí es la hora en que se INICIÓ LA RUTA (la parada nace ahí), no la del
    // marcado. Por eso hace falta esta columna para saber qué se marcó en diferido.
    synced_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Cuándo llegó el marcado al servidor si venía de la cola offline. NULL = en vivo.'
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