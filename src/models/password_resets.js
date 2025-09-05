const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  const PasswordResets = sequelize.define('password_resets', {
    id: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    token: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    verification_code: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    method: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [['email', 'whatsapp']]
      }
    },
    sent_to: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    used_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('now')
    },
    ip_address_of_request: {
      type: DataTypes.STRING(45),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'password_resets',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "password_resets_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "idx_password_resets_token",
        fields: [
          { name: "token" },
        ]
      },
      {
        name: "idx_password_resets_verification_code",
        fields: [
          { name: "verification_code" },
        ]
      },
    ]
  });

  // Definir asociaciones
  PasswordResets.associate = function(models) {
    // Relación belongsTo con users
    PasswordResets.belongsTo(models.users, {
      foreignKey: 'user_id',
      as: 'user'
    });
  };

  return PasswordResets;
};
