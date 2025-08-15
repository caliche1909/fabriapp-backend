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
            defaultValue: null,
            unique: 'companies_tax_id_key',
            validate: {
                isTaxIdValid: function (value) {
                    // Acepta null o string vacío sin validación
                    if (value === null || value === '') return;

                    // Si tiene valor, aplica la validación
                    if (!/^[A-Z0-9\-]+$/.test(value)) {
                        throw new Error('El NIT/RUT solo puede contener letras mayúsculas, números y guiones');
                    }
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
        neighborhood: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        logo_url: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null,
            validate: {
                isUrlOrEmpty: function (value) {
                    // Acepta null o string vacío sin validación
                    if (value === null || value === '') return;

                    // Si tiene valor, valida que sea una URL HTTP/HTTPS válida
                    try {
                        new URL(value); // Intenta crear un objeto URL
                        if (!value.startsWith('http://') && !value.startsWith('https://')) {
                            throw new Error();
                        }
                    } catch {
                        throw new Error('El formato de la URL del logo no es válido. Debe comenzar con http:// o https://');
                    }
                }
            }
        },
        logo_public_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Public ID de Cloudinary para el logo de la empresa, usado para eliminar la imagen'
        },
        website: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null,
            validate: {
                isUrlOrEmpty: function (value) {
                    // Acepta null o string vacío sin validación
                    if (value === null || value === '') return;

                    // Si tiene valor, valida que sea una URL HTTP/HTTPS válida
                    try {
                        new URL(value); // Intenta crear un objeto URL
                        if (!value.startsWith('http://') && !value.startsWith('https://')) {
                            throw new Error();
                        }
                    } catch {
                        throw new Error('El formato de la URL del sitio web no es válido. Debe comenzar con http:// o https://');
                    }
                }
            }
        },
        ubicacion: {
            type: DataTypes.GEOMETRY('POINT', 4326),
            allowNull: true
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
            },
            {
                name: "idx_companies_neighborhood",
                fields: [{ name: "neighborhood" }]
            },
            {
                name: "idx_companies_ubicacion",
                using: 'GIST',
                fields: [{ name: "ubicacion" }]
            }
        ]
    });

    // Métodos de instancia para manejar PostGIS
    Company.prototype.setUbicacion = function (lat, lng) {
        return sequelize.fn('ST_SetSRID',
            sequelize.fn('ST_MakePoint', lng, lat),
            4326
        );
    };

    Company.prototype.getLatitud = function () {
        if (this.ubicacion) {
            return sequelize.fn('ST_Y', this.ubicacion);
        }
        return null;
    };

    Company.prototype.getLongitud = function () {
        if (this.ubicacion) {
            return sequelize.fn('ST_X', this.ubicacion);
        }
        return null;
    };

    // Método estático para buscar compañías por proximidad
    Company.findByProximity = function (lat, lng, radiusKm = 10) {
        const punto = sequelize.fn('ST_SetSRID',
            sequelize.fn('ST_MakePoint', lng, lat),
            4326
        );

        return this.findAll({
            where: sequelize.where(
                sequelize.fn('ST_DWithin',
                    sequelize.col('ubicacion'),
                    punto,
                    radiusKm / 111.32
                ),
                true
            ),
            attributes: {
                include: [
                    [sequelize.fn('ST_Distance',
                        sequelize.col('ubicacion'),
                        punto
                    ) * 111320, 'distancia_metros']
                ]
            },
            order: [[sequelize.literal('distancia_metros'), 'ASC']]
        });
    };

    // Método para obtener la dirección completa incluyendo barrio
    Company.prototype.getFullAddress = function () {
        const parts = [this.address, this.neighborhood, this.city, this.state, this.country, this.postal_code];
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