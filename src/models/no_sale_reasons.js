const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const NoSaleReasons = sequelize.define('no_sale_reasons', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'no_sale_categories',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: "El ID de la categoría es requerido"
        }
      }
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: {
          msg: "El nombre del motivo es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Descripción opcional del motivo"
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
    tableName: 'no_sale_reasons',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hasTrigger: true,
    indexes: [
      {
        name: "no_sale_reasons_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_no_sale_reasons_category",
        fields: [
          { name: "category_id" }
        ]
      },
      {
        name: "idx_no_sale_reasons_company",
        fields: [
          { name: "company_id" }
        ]
      },
      {
        name: "idx_no_sale_reasons_active",
        fields: [
          { name: "is_active" }
        ]
      }
    ],
    validate: {
      // Validación personalizada para el constraint check_reason_global_and_company_id
      checkReasonGlobalAndCompanyId() {
        if (this.is_global === true && this.company_id !== null) {
          throw new Error('Los motivos globales no deben tener company_id');
        }
        if (this.is_global === false && this.company_id === null) {
          throw new Error('Los motivos no globales deben tener company_id');
        }
      }
    }
  });

  // Métodos estáticos útiles
  NoSaleReasons.findGlobalReasons = function() {
    return this.findAll({
      where: {
        is_global: true,
        is_active: true
      },
      include: [{
        model: sequelize.models.no_sale_categories,
        as: 'category',
        where: { is_active: true }
      }],
      order: [
        [{ model: sequelize.models.no_sale_categories, as: 'category' }, 'name', 'ASC'],
        ['name', 'ASC']
      ]
    });
  };

  NoSaleReasons.findByCompany = function(companyId) {
    return this.findAll({
      where: {
        [sequelize.Op.or]: [
          { is_global: true },
          { company_id: companyId }
        ],
        is_active: true
      },
      include: [{
        model: sequelize.models.no_sale_categories,
        as: 'category',
        where: { 
          [sequelize.Op.or]: [
            { is_global: true },
            { company_id: companyId }
          ],
          is_active: true
        }
      }],
      order: [
        [{ model: sequelize.models.no_sale_categories, as: 'category' }, 'name', 'ASC'],
        ['is_global', 'DESC'],
        ['name', 'ASC']
      ]
    });
  };

  NoSaleReasons.findByCategory = function(categoryId, companyId = null) {
    const whereCondition = {
      category_id: categoryId,
      is_active: true
    };

    if (companyId) {
      whereCondition[sequelize.Op.or] = [
        { is_global: true },
        { company_id: companyId }
      ];
    } else {
      whereCondition.is_global = true;
    }

    return this.findAll({
      where: whereCondition,
      order: [['is_global', 'DESC'], ['name', 'ASC']]
    });
  };

  NoSaleReasons.associate = (models) => {
    // Relación con no_sale_categories (muchos motivos pertenecen a una categoría)
    NoSaleReasons.belongsTo(models.no_sale_categories, {
      foreignKey: 'category_id',
      as: 'category'
    });

    // Relación con companies (para motivos específicos de empresa)
    NoSaleReasons.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'company'
    });

    // 📋 Relación con StoreNoSaleReports - Una razón puede tener muchos reportes
    NoSaleReasons.hasMany(models.store_no_sale_reports, {
      foreignKey: 'reason_id',
      as: 'reports',
      onDelete: 'RESTRICT', // No se puede eliminar una razón en uso
      onUpdate: 'CASCADE'
    });
  };

  return NoSaleReasons;
};