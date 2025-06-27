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
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
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
            }
        ]
    });

    // Métodos de instancia
    Company.prototype.getFullAddress = function () {
        const parts = [this.address, this.city, this.state, this.country, this.postal_code];
        return parts.filter(Boolean).join(', ');
    };

    // Método actualizado para verificar si un usuario es owner usando user_companies
    Company.prototype.isOwner = async function (userId) {
        const ownerRecord = await sequelize.models.user_companies.findOne({
            where: {
                company_id: this.id,
                user_id: userId,
                user_type: 'owner',
                status: 'active'
            }
        });
        return !!ownerRecord;
    };

    // Método para obtener el propietario de la empresa
    Company.prototype.getOwner = async function () {
        const ownerRecord = await sequelize.models.user_companies.findOne({
            where: {
                company_id: this.id,
                user_type: 'owner',
                status: 'active'
            },
            include: [{
                model: sequelize.models.users,
                as: 'user'
            }]
        });
        return ownerRecord ? ownerRecord.user : null;
    };

    // Método estático para crear empresa con owner
    Company.createWithOwner = async function (companyData, userId, roleId, setAsDefault = false) {
        const transaction = await sequelize.transaction();
        try {
            // Crear la empresa
            const company = await Company.create(companyData, { transaction });

            // Si es la primera empresa del usuario o se especifica, establecer como default
            if (setAsDefault) {
                // Establecer todas las otras empresas del usuario como no predeterminadas
                await sequelize.models.user_companies.update(
                    { is_default: false },
                    { 
                        where: { user_id: userId },
                        transaction
                    }
                );
            }

            // Crear la relación owner en user_companies
            await sequelize.models.user_companies.create({
                user_id: userId,
                company_id: company.id,
                role_id: roleId,
                user_type: 'owner',
                is_default: setAsDefault,
                status: 'active'
            }, { transaction });

            await transaction.commit();
            return company;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    };

    // Relaciones
    Company.associate = function (models) {
        // Una compañía puede tener muchos insumos
        Company.hasMany(models.inventory_supplies, {
            foreignKey: 'company_id',
            as: 'inventory_supplies'
        });

        // Relación muchos a muchos con users a través de user_companies
        Company.belongsToMany(models.users, {
            through: models.user_companies,
            foreignKey: 'company_id',
            otherKey: 'user_id',
            as: 'assigned_users'
        });

        // Relación con user_companies
        Company.hasMany(models.user_companies, {
            foreignKey: 'company_id',
            as: 'user_assignments'
        });
    };

    return Company;
}; 