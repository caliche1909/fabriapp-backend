const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🏷️ PRESENTACIONES DE PRODUCTOS (etiqueta de venta: "Unidad", "Paq x8", "Paca x12x5").
  // Catálogo LIGERO por compañía (tenant-scoped), SIN factor de conversión (productos simples).
  // Reemplaza el uso del catálogo global measurement_units para productos. Paranoid + auditoría.
  const ProductPresentations = sequelize.define('product_presentations', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    company_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'companies', key: 'id' },
      onDelete: 'CASCADE',
      comment: 'Compañía dueña de la presentación (aislamiento multi-tenant)'
    },
    name: {
      type: DataTypes.STRING(60),
      allowNull: false,
      validate: { notEmpty: true }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de eliminación lógica. NULL = activa'
    },
    deleted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      comment: 'Usuario que eliminó la presentación (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'product_presentations',
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
      beforeDestroy: (instance, options) => {
        if (options && options.userId) {
          instance.deleted_by = options.userId;
        } else {
          throw new Error('Se requiere un userId para eliminar un registro y mantener la auditoría.');
        }
      },
      beforeRestore: (instance) => {
        instance.deleted_by = null;
      }
    },
    indexes: [
      { name: 'idx_product_presentations_company', fields: [{ name: 'company_id' }] }
    ]
  });

  ProductPresentations.associate = (models) => {
    ProductPresentations.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    ProductPresentations.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
    ProductPresentations.hasMany(models.products, { foreignKey: 'presentation_id', as: 'products' });
  };

  return ProductPresentations;
};
