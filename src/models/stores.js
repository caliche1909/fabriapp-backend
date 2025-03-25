const Sequelize = require('sequelize');
module.exports = function (sequelize, DataTypes) {
  const Stores = sequelize.define('stores', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    route_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'routes',
        key: 'id'
      }
    },
    manager_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    store_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'store_types',
        key: 'id'
      }
    },
    image_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    latitude: {
      type: DataTypes.DECIMAL(23,20),
      allowNull: true
    },
    longitude: {
      type: DataTypes.DECIMAL(24,20),
      allowNull: true
    },
    opening_time: {
      type: DataTypes.TIME,
      allowNull: true
    },
    closing_time: {
      type: DataTypes.TIME,
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
    neighborhood: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
  }, {
    sequelize,
    tableName: 'stores',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    hasTrigger: true,
    indexes: [
      {
        name: "idx_stores_manager_id",
        fields: [
          { name: "manager_id" }
        ]
      },
      {
        name: "idx_stores_route_id",
        fields: [
          { name: "route_id" }
        ]
      },
      {
        name: "idx_stores_store_type_id",
        fields: [
          { name: "store_type_id" }
        ]
      },
      {
        name: "stores_pkey",
        unique: true,
        fields: [
          { name: "id" }
        ]
      },
    ]
  });

  // Asociaciones
  Stores.associate = (models) => {
    Stores.belongsTo(models.routes, {
      foreignKey: 'route_id',
      as: 'route'
    });

    Stores.belongsTo(models.store_types, {
      foreignKey: "store_type_id",
      as: "store_type"
    });

    Stores.belongsTo(models.users, {
      foreignKey: "manager_id",
      as: "manager"
    });
  };

  return Stores;
};
