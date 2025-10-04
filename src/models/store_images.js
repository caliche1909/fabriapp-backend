const Sequelize = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const StoreImage = sequelize.define('store_images', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false
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
    image_url: {
      type: DataTypes.STRING(500),
      allowNull: false,
      validate: {
        notNull: {
          msg: "La URL de la imagen es requerida"
        },
        notEmpty: {
          msg: "La URL no puede estar vacía"
        },
        isUrl: {
          msg: "Debe ser una URL válida"
        }
      }
    },
    public_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'ID público de Cloudinary'
    },
    format: {
      type: DataTypes.STRING(10),
      allowNull: true,
      validate: {
        isIn: {
          args: [['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']],
          msg: "Formato de imagen no válido"
        }
      }
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [1],
          msg: "El ancho debe ser mayor a 0"
        }
      }
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [1],
          msg: "La altura debe ser mayor a 0"
        }
      }
    },
    bytes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [1],
          msg: "El tamaño debe ser mayor a 0"
        }
      }
    },
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      validate: {
        notNull: {
          msg: "El campo is_primary es requerido"
        }
      }
    },
    uploaded_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    sequelize,
    tableName: 'store_images',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false, // desabilita borrado lógico   
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    indexes: [
      {
        name: "store_images_pkey",
        unique: true,
        fields: [{ name: "id" }]
      },
      {
        name: "idx_store_images_store_id",
        fields: [{ name: "store_id" }]
      },
      {
        name: "idx_store_images_uploaded_by",
        fields: [{ name: "uploaded_by" }]
      },
      {
        name: "idx_store_images_is_primary",
        fields: [{ name: "is_primary" }]
      },
      {
        name: "idx_store_images_store_primary",
        unique: true,
        fields: [{ name: "store_id" }, { name: "is_primary" }],
        where: {
          is_primary: true
        }
      },
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