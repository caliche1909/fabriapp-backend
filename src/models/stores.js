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
      type: DataTypes.DECIMAL,
      allowNull: true
    },
    longitude: {
      type: DataTypes.DECIMAL,
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
          { name: "manager_id" },
        ]
      },
      {
        name: "idx_stores_route_id",
        fields: [
          { name: "route_id" },
        ]
      },
      {
        name: "idx_stores_store_type_id",
        fields: [
          { name: "store_type_id" },
        ]
      },
      {
        name: "stores_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });

  // Definir la asociación belongsTo para la relación con Routes
  Stores.associate = (models) => {

    // 🔹 Relación con routes (está bien)
    Stores.belongsTo(models.routes, {
      foreignKey: 'route_id',
      as: 'route'
    });
    
    // 🔹 Relación con store_types (está bien)
    Stores.belongsTo(models.store_types, {
      foreignKey: "store_type_id",
      as: "store_type"
  });
  };

  return Stores;
};

