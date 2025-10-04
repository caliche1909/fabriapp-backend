const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {

  const UserCurrentPosition = sequelize.define('user_current_position', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: 'users',
        key: 'id'
      },
      validate: {
        notNull: {
          msg: "El ID del usuario es requerido"
        }
      }
    },
    position: {
      type: DataTypes.GEOGRAPHY('POINT', 4326),
      allowNull: true,       // Ahora puede ser NULL hasta que llegue la primera ubicación real
    },
    accuracy: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      validate: {
        min: {
          args: [0],
          msg: "La precisión no puede ser negativa"
        },
        max: {
          args: [999999.99],
          msg: "La precisión no puede ser mayor a 999999.99 metros"
        }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      validate: {
        notNull: {
          msg: "El estado activo es requerido"
        }
      }
    },
    last_update_source: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'mobile_app',
      validate: {
        isIn: {
          args: [['mobile_app', 'web', 'system_activation', 'system_reactivation', 'api', 'background_service']],
          msg: "El origen de actualización debe ser uno de: mobile_app, web, system_activation, system_reactivation, api, background_service"
        }
      }
    }
  }, {
    sequelize,
    tableName: 'user_current_position',
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'public',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "idx_user_current_position_user_id",
        fields: [{ name: "user_id" }]
      },
      {
        name: "idx_user_current_position_active",
        fields: [{ name: "is_active" }],
        where: {
          is_active: true
        }
      },
      {
        name: "idx_user_current_position_updated_at",
        fields: [{ name: "updated_at" }]
      },
      {
        name: "idx_user_current_position_geography",
        fields: [{ name: "position" }],
        using: 'GIST'
      }
    ]
  });

  // Método para obtener las coordenadas como objeto
  UserCurrentPosition.prototype.getCoordinates = function () {
    if (!this.position) return null;

    // Extraer coordenadas del POINT de PostGIS
    const coordinates = this.position.coordinates;
    return {
      longitude: coordinates[0],
      latitude: coordinates[1]
    };
  };

  // Método para actualizar posición
  UserCurrentPosition.prototype.updatePosition = async function (latitude, longitude, accuracy = null, source = 'mobile_app') {
    this.position = {
      type: 'Point',
      coordinates: [longitude, latitude]
    };

    if (accuracy !== null) {
      this.accuracy = accuracy;
    }

    this.last_update_source = source;
    this.is_active = true;

    await this.save();
  };

  // Método para desactivar tracking
  UserCurrentPosition.prototype.deactivate = async function () {
    this.is_active = false;
    this.last_update_source = 'system_deactivation';
    await this.save();
  };

  // Método para verificar si la posición es reciente
  UserCurrentPosition.prototype.isRecent = function (minutesThreshold = 5) {
    const now = new Date();
    const diffMinutes = (now - this.updated_at) / (1000 * 60);
    return diffMinutes <= minutesThreshold;
  };

  // Método para verificar si la posición tiene buena precisión
  UserCurrentPosition.prototype.hasGoodAccuracy = function (accuracyThreshold = 100) {
    return this.accuracy !== null && this.accuracy <= accuracyThreshold;
  };

  // Método para obtener tiempo transcurrido desde última actualización
  UserCurrentPosition.prototype.getTimeSinceLastUpdate = function () {
    const now = new Date();
    const diffSeconds = Math.floor((now - this.updated_at) / 1000);

    if (diffSeconds < 60) {
      return `${diffSeconds} segundos`;
    } else if (diffSeconds < 3600) {
      return `${Math.floor(diffSeconds / 60)} minutos`;
    } else {
      return `${Math.floor(diffSeconds / 3600)} horas`;
    }
  };

  // Método estático para encontrar usuarios cerca de una ubicación
  UserCurrentPosition.findNearbyUsers = async function (latitude, longitude, radiusMeters = 1000) {
    const query = `
      SELECT 
        ucp.*,
        ST_Distance(
          ucp.position::geometry,
          ST_MakePoint(:longitude, :latitude)::geometry
        ) as distance_meters
      FROM user_current_position ucp
      WHERE ucp.is_active = true
      AND ST_DWithin(
        ucp.position::geometry,
        ST_MakePoint(:longitude, :latitude)::geometry,
        :radius
      )
      ORDER BY distance_meters ASC
    `;

    return await sequelize.query(query, {
      replacements: {
        latitude: latitude,
        longitude: longitude,
        radius: radiusMeters
      },
      type: sequelize.QueryTypes.SELECT
    });
  };

  // Método estático para calcular distancia entre dos usuarios
  UserCurrentPosition.calculateDistanceBetweenUsers = async function (userId1, userId2) {
    const query = `
      SELECT ST_Distance(
        pos1.position::geometry,
        pos2.position::geometry
      ) as distance_meters
      FROM user_current_position pos1, user_current_position pos2
      WHERE pos1.user_id = :userId1 
      AND pos2.user_id = :userId2
      AND pos1.is_active = true 
      AND pos2.is_active = true
    `;

    const result = await sequelize.query(query, {
      replacements: {
        userId1: userId1,
        userId2: userId2
      },
      type: sequelize.QueryTypes.SELECT
    });

    return result[0]?.distance_meters || -1;
  };

  // Relaciones
  UserCurrentPosition.associate = (models) => {
    UserCurrentPosition.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });
  };

  return UserCurrentPosition;
}; 