const Sequelize = require('sequelize');

module.exports = function (sequelize, DataTypes) {
    const Company = sequelize.define('companies', {
        id: {
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal('uuid_generate_v4()'),
            allowNull: false,
            primaryKey: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notNull: {
                    msg: 'El nombre de la compañía es requerido'
                },
                notEmpty: {
                    msg: 'El nombre de la compañía no puede estar vacío'
                }
            }
        },
        legal_name: {
            type: DataTypes.STRING(150),
            allowNull: false,
            validate: {
                notNull: {
                    msg: 'La razón social es requerida'
                },
                notEmpty: {
                    msg: 'La razón social no puede estar vacía'
                }
            }
        },
        tax_id: {
            type: DataTypes.STRING(20),
            allowNull: true,
            unique: 'companies_tax_id_key',
            validate: {
                is: {
                    args: /^[A-Z0-9\-]+$/,
                    msg: 'El NIT/RUT solo puede contener letras mayúsculas, números y guiones'
                }
            }
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: true,
            unique: 'companies_email_key',
            validate: {
                isEmail: {
                    msg: 'El formato del email no es válido'
                }
            }
        },
        phone: {
            type: DataTypes.STRING(20),
            allowNull: true,
            validate: {
                is: {
                    args: /^[\d-]{9,19}$/,
                    msg: "Numero de telefono invalido"
                }
            }
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        city: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        state: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        country: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        postal_code: {
            type: DataTypes.STRING(10),
            allowNull: true
        },
        logo_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
            validate: {
                isUrl: {
                    msg: 'El formato de la URL del logo no es válido'
                }
            }
        },
        website: {
            type: DataTypes.STRING(255),
            allowNull: true,
            validate: {
                isUrl: {
                    msg: 'El formato de la URL del sitio web no es válido'
                }
            }
        },
        owner_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            validate: {
                notNull: {
                    msg: 'El propietario es requerido'
                }
            }
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        is_default: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
    }, {
        sequelize,
        tableName: 'companies',
        timestamps: true,
        underscored: true,
        freezeTableName: true,
        schema: 'public',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: "idx_companies_owner_id",
                fields: [{ name: "owner_id" }]
            },
            {
                name: "idx_companies_is_active",
                fields: [{ name: "is_active" }]
            },
            {
                name: "idx_companies_name",
                fields: [{ name: "name" }]
            },
            {
                name: "idx_companies_country",
                fields: [{ name: "country" }]
            },
            {
                name: "idx_companies_is_default",
                fields: [{ name: "is_default" }]
            }
        ]
    });

    // Métodos de instancia
    Company.prototype.getFullAddress = function () {
        const parts = [this.address, this.city, this.state, this.country, this.postal_code];
        return parts.filter(Boolean).join(', ');
    };

    Company.prototype.isOwner = function (userId) {
        return this.owner_id === userId;
    };

    // Método para establecer esta compañía como predeterminada
    Company.prototype.setAsDefault = async function () {
        const transaction = await sequelize.transaction();
        try {
            // Primero, establecer todas las compañías del mismo propietario como no predeterminadas
            await Company.update(
                { is_default: false },
                { 
                    where: { 
                        owner_id: this.owner_id,
                        id: { [Sequelize.Op.ne]: this.id }
                    },
                    transaction
                }
            );

            // Luego, establecer esta compañía como predeterminada
            this.is_default = true;
            await this.save({ transaction });

            await transaction.commit();
            return true;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    };

    // Relaciones
    Company.associate = function (models) {
        // Una compañía pertenece a un usuario (owner)
        Company.belongsTo(models.users, {
            as: 'owner',
            foreignKey: 'owner_id'
        });

        // Aquí puedes agregar más relaciones en el futuro
        // Por ejemplo, con stores, employees, etc.
    };

    return Company;
}; 