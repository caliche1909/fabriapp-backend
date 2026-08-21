const Sequelize = require('sequelize');
module.exports = function (sequelize, DataTypes) {
  const Sales = sequelize.define('sales', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' }
    },
    sale_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' }
    },
    payment_method_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'payment_methods',
        key: 'id'
      }
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Puede ser null si la venta no está asociada a una ruta específica
      references: {
        model: 'routes',
        key: 'id'
      }
    },
    visit_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Puede ser null si la venta no está asociada a una visita específica
      references: {
        model: 'store_visits', // Asumiendo que tienes este modelo
        key: 'id'
      }
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Bodega desde la que se vendió (bodega móvil del vendedor). Las ventas viejas no la tienen.
      references: {
        model: 'inventory_locations',
        key: 'id'
      }
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.STRING(25),
      allowNull: false,
      defaultValue: 'completed',
      validate: {
        isIn: [['pending', 'processing', 'completed', 'pending_payment', 'voided']]
      }
    }
  }, {
    sequelize,
    tableName: 'sales',
    timestamps: true,
    paranoid: true, // Habilita soft delete
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    deletedAt: 'deleted_at',
    hooks: {
      beforeDestroy: (instance, options) => {
        if (!options.userId) throw new Error("userId es requerido para la auditoría de eliminación.");
        instance.deleted_by = options.userId;
      },
      beforeRestore: (instance, options) => {
        instance.deleted_by = null;
      }
    },
    indexes: [
      // 🎯 ÍNDICES QUE COINCIDEN EXACTAMENTE CON LA TABLA
      {
        name: "idx_sales_active_by_company",
        fields: [{ name: "company_id" }],
        where: {
          deleted_at: null // Solo para ventas activas
        }
      },
      {
        name: "idx_sales_active_by_route",
        fields: [{ name: "route_id" }],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_sales_active_by_store",
        fields: [{ name: "store_id" }],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_sales_active_by_user",
        fields: [{ name: "user_id" }],
        where: {
          deleted_at: null
        }
      },
      {
        name: "idx_sales_date_route", // Índice compuesto para reportes por fecha y ruta
        fields: [
          { name: "sale_date" },
          { name: "route_id" },
        ]
      },
      {
        name: "idx_sales_active_by_location", // Ventas por bodega (activas)
        fields: [{ name: "location_id" }],
        where: { deleted_at: null }
      },
      {
        // En la BD (migración 20260811120100) es parcial también por `visit_id IS NOT NULL`;
        // aquí se documenta la parte principal (activas). Para sumar/consultar las varias ventas de una visita.
        name: "idx_sales_active_by_visit",
        fields: [{ name: "visit_id" }],
        where: { deleted_at: null }
      },
      {
        name: "sales_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      }
    ]
  });

  // 🔗 Definir asociaciones del modelo Sales
  Sales.associate = function (models) {

    // 📌 Relación con Companies
    Sales.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company',
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Stores
    Sales.belongsTo(models.stores, {
      foreignKey: 'store_id',
      as: 'store',
      onDelete: 'RESTRICT',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Users (vendedor)
    Sales.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user',
      onDelete: 'RESTRICT',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Payment Methods
    Sales.belongsTo(models.payment_methods, {
      foreignKey: 'payment_method_id',
      as: 'payment_method',
      onDelete: 'RESTRICT',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Routes (opcional)
    Sales.belongsTo(models.routes, {
      foreignKey: 'route_id',
      as: 'route',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Store Visits (opcional)
    Sales.belongsTo(models.store_visits, {
      foreignKey: 'visit_id',
      as: 'visit',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con la BODEGA desde la que se vendió (opcional)
    Sales.belongsTo(models.inventory_locations, {
      foreignKey: 'location_id',
      as: 'location',
      onDelete: 'RESTRICT',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con el DETALLE de la venta (sus ítems)
    Sales.hasMany(models.sale_items, {
      foreignKey: 'sale_id',
      as: 'items',
      onDelete: 'CASCADE'
    });

    // 📌 Relación con Users (usuario que eliminó)
    Sales.belongsTo(models.users, {
      foreignKey: 'deleted_by',
      as: 'deleted_by_user',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    });
  };

  return Sales;
};
