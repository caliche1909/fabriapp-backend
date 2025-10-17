const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  const PaymentMethods = sequelize.define('payment_methods', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'companies',
        key: 'id'
      }
    },
    is_global: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    commission: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0.00,
      validate: {
        min: 0.00,
        max: 100.00
      }
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
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
    }
  }, {
    sequelize,
    tableName: 'payment_methods',
    timestamps: true,
    paranoid: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    indexes: [
      {
        name: "payment_methods_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "idx_payment_methods_company_id",
        fields: [
          { name: "company_id" }
        ]
      },
      {
        name: "idx_payment_methods_global_active",
        fields: [
          { name: "id" }
        ],
        where: {
          is_global: true,
          is_active: true,
          deleted_at: null
        }
      },
      {
        name: "idx_payment_methods_company_active", 
        fields: [
          { name: "company_id" }
        ],
        where: {
          is_active: true,
          deleted_at: null
        }
      }
    ]
  });

  // 🔗 Definir asociaciones del modelo
  PaymentMethods.associate = function(models) {
    // 📌 Relación con Companies
    PaymentMethods.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company',
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION'
    });

    // 📌 Relación con Users (usuario que eliminó)
    PaymentMethods.belongsTo(models.users, {
      foreignKey: 'deleted_by',
      as: 'deleted_by_user',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    });
  };

  return PaymentMethods;
};
