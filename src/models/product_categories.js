const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  // 🏷️ CATEGORÍAS DE PRODUCTOS (planas, tenant-scoped). Paranoid + auditoría.
  const ProductCategories = sequelize.define('product_categories', {
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
      comment: 'Compañía dueña de la categoría (aislamiento multi-tenant)'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
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
      comment: 'Usuario que eliminó la categoría (auditoría)'
    }
  }, {
    sequelize,
    tableName: 'product_categories',
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
      { name: 'idx_product_categories_company', fields: [{ name: 'company_id' }] }
    ]
  });

  ProductCategories.associate = (models) => {
    ProductCategories.belongsTo(models.companies, { foreignKey: 'company_id', as: 'company' });
    ProductCategories.belongsTo(models.users, { foreignKey: 'deleted_by', as: 'deleted_by_user' });
    ProductCategories.hasMany(models.products, { foreignKey: 'category_id', as: 'products' });
  };

  return ProductCategories;
};
