// models/storeImage.js
module.exports = (sequelize, DataTypes) => {
  const StoreImage = sequelize.define('store_images', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    store_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'stores',
        key: 'id'
      }
    },
    image_url: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isUrl: true
      }
    },
    public_id: DataTypes.STRING,
    format: DataTypes.STRING(10),
    width: DataTypes.INTEGER,
    height: DataTypes.INTEGER,
    bytes: DataTypes.INTEGER,
    is_primary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    uploaded_by: {
      type: DataTypes.INTEGER,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    deleted_at: DataTypes.DATE
  }, {
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true, // Habilita borrado lógico
    deletedAt: 'deleted_at',
    underscored: true,
    indexes: [
      {
        fields: ['store_id']
      },
      {
        fields: ['store_id', 'is_primary'],
        where: { is_primary: true }
      }
    ]
  });

  StoreImage.associate = (models) => {
    StoreImage.belongsTo(models.stores, {
      foreignKey: 'store_id',
      as: 'store'
    });
    StoreImage.belongsTo(models.users, {
      foreignKey: 'uploaded_by',
      as: 'uploader'
    });
  };

  return StoreImage;
};