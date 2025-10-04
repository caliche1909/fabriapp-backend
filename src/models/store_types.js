const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
  const StoreTypes = sequelize.define('store_types', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "store_types_name_key",
      validate: {
        notNull: {
          msg: "El nombre del tipo de tienda es requerido"
        },
        notEmpty: {
          msg: "El nombre no puede estar vacío"
        }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'store_types',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "store_types_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
      {
        name: "idx_store_types_name",
        fields: [
          { name: "name" }
        ]
      },
      {
        name: "store_types_name_key",
        unique: true,
        fields: [
          { name: "name" }
        ]
      }
    ]
  });

  StoreTypes.associate = (models) => {
    StoreTypes.hasMany(models.stores, {
      foreignKey: 'store_type_id',
      as: 'stores'
    });
  };

  return StoreTypes;
};
