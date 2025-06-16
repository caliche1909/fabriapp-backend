const Sequelize = require('sequelize');

module.exports = function(sequelize, DataTypes) {
  const SupplierVerifications = sequelize.define('supplier_verifications', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false
    },
    // ID del proveedor que está siendo verificado
    // Relación con supplier_companies.id
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'supplier_companies',
        key: 'id'
      },
      onDelete: 'CASCADE',
      validate: {
        notNull: {
          msg: 'El ID del proveedor es requerido'
        }
      }
    },
    // ID de la compañía que está verificando el proveedor
    // Relación con companies.id
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El ID de la compañía es requerido'
        }
      }
    },
    // ID del usuario que realizó la verificación
    // Relación con users.id
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: 'El ID del usuario es requerido'
        }
      }
    },
    // Timestamp de cuándo se realizó la verificación
    verified_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'supplier_verifications',
    schema: 'public',
    timestamps: false, // No usamos timestamps automáticos, manejamos verified_at manualmente
    underscored: true,
    freezeTableName: true,
    indexes: [
      {
        name: "supplier_verifications_pkey",
        unique: true,
        fields: [{ name: "id" }]
      },
      {
        name: "idx_supplier_verifications_supplier",
        fields: [{ name: "supplier_id" }]
      },
      {
        name: "supplier_verifications_supplier_id_company_id_key",
        unique: true,
        fields: [
          { name: "supplier_id" },
          { name: "company_id" }
        ]
      }
    ]
  });

  // Método de instancia para verificar si la verificación es reciente (últimos 30 días)
  SupplierVerifications.prototype.isRecent = function() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return this.verified_at >= thirtyDaysAgo;
  };

  // Método estático para obtener el conteo de verificaciones de un proveedor
  SupplierVerifications.getVerificationCount = async function(supplierId) {
    return await this.count({
      where: { supplier_id: supplierId }
    });
  };

  // Método estático para verificar si una compañía ya verificó un proveedor
  SupplierVerifications.hasCompanyVerified = async function(supplierId, companyId) {
    const verification = await this.findOne({
      where: {
        supplier_id: supplierId,
        company_id: companyId
      }
    });
    return !!verification;
  };

  // Definir las asociaciones
  SupplierVerifications.associate = (models) => {
    // Relación con el proveedor verificado
    SupplierVerifications.belongsTo(models.supplier_companies, {
      foreignKey: 'supplier_id',
      as: 'supplier',
      onDelete: 'CASCADE'
    });

    // Relación con la compañía que verificó
    SupplierVerifications.belongsTo(models.companies, {
      foreignKey: 'company_id',
      as: 'verifying_company'
    });

    // Relación con el usuario que realizó la verificación
    SupplierVerifications.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'verifying_user'
    });
  };

  return SupplierVerifications;
}; 