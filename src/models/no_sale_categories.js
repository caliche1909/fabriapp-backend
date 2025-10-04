const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const NoSaleCategories = sequelize.define('no_sale_categories', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: {
          msg: "El nombre de la categoría es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    is_global: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      validate: {
        notNull: {
          msg: "El campo is_global es requerido"
        }
      }
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'companies',
        key: 'id'
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      validate: {
        notNull: {
          msg: "El campo is_active es requerido"
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Descripción opcional de la categoría"
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
    tableName: 'no_sale_categories',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hasTrigger: true,
    indexes: [
      {
        name: "no_sale_categories_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_no_sale_categories_company_id",
        fields: [
          { name: "company_id" }
        ]
      },
      {
        name: "idx_no_sale_categories_active",
        fields: [
          { name: "is_active" }
        ]
      }
    ],
    validate: {
      // Validación personalizada para el constraint check_global_and_company_id
      checkGlobalAndCompanyId() {
        if (this.is_global === true && this.company_id !== null) {
          throw new Error('Las categorías globales no deben tener company_id');
        }
        if (this.is_global === false && this.company_id === null) {
          throw new Error('Las categorías no globales deben tener company_id');
        }
      }
    }
  });

  // Métodos estáticos útiles
  NoSaleCategories.findGlobalCategories = function() {
    return this.findAll({
      where: {
        is_global: true,
        is_active: true
      },
      order: [['id', 'ASC']] // Ordenar por ID ascendente para consistencia
    });
  };

  NoSaleCategories.findByCompany = function(companyId) {
    const { Op } = require('sequelize');
    return this.findAll({
      where: {
        [Op.or]: [
          { is_global: true },
          { company_id: companyId }
        ],
        is_active: true
      },
      order: [
        ['is_global', 'DESC'], // Primero las de la compañía (false), después las globales (true)
        ['id', 'ASC']          // Dentro de cada grupo, ordenar por ID ascendente
      ]
    });
  };

  NoSaleCategories.associate = (models) => {
    // Relación con companies
    NoSaleCategories.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    // Relación con no_sale_reasons (una categoría tiene muchos motivos)
    NoSaleCategories.hasMany(models.no_sale_reasons, {
      foreignKey: 'category_id',
      as: 'reasons'
    });

    // 📊 Relación con StoreNoSaleReports - Una categoría puede tener muchos reportes
    NoSaleCategories.hasMany(models.store_no_sale_reports, {
      foreignKey: 'category_id',
      as: 'reports',
      onDelete: 'RESTRICT', // No se puede eliminar una categoría en uso
      onUpdate: 'CASCADE'
    });
  };

  return NoSaleCategories;
};