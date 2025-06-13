const Sequelize = require('sequelize');

module.exports = function(sequelize, DataTypes) {
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
      }
    ]
  });

  // Método de instancia para obtener la dirección completa
  SupplierCompanies.prototype.getFullAddress = function() {
    const parts = [this.address, this.city, this.state, this.country];
    return parts.filter(Boolean).join(', ');
  };

  // Definir las asociaciones
  SupplierCompanies.associate = (models) => {
    // Relación muchos a muchos con insumos
    SupplierCompanies.belongsToMany(models.inventory_supplies, {
      through: models.inventory_supplies_suppliers,
      foreignKey: 'supplier_id',
      otherKey: 'inventory_supply_id',
      as: 'supplies'
    });

    // Relación con la tabla intermedia
    SupplierCompanies.hasMany(models.inventory_supplies_suppliers, {
      foreignKey: 'supplier_id',
      as: 'supply_details'
    });
  };

  return SupplierCompanies;
};
