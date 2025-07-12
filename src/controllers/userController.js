const { users, roles, permissions, companies, user_companies, user_current_position, sequelize } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sendWelcomeEmail } = require('../utils/emailNotifier');

const SALT_ROUNDS = 10;
const SECRET_KEY = process.env.JWT_SECRET;

module.exports = {

    // 📌 LOGIN DE USUARIO
    async login(req, res) {
        try {
            const { email, password } = req.body;

            // Validar email
            if (!email) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ingrese su email"
                });
            }

            // Validar password
            if (!password) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ingrese su contraseña"
                });
            }

            // Buscar usuario con posición actual (sin roles globales)
            const userForLogin = await users.findOne({
                where: { email: email },
                include: [
                    {
                        model: user_current_position,
                        as: 'current_position',
                        attributes: ['id', 'position', 'accuracy', 'is_active', 'updated_at'],
                        required: false // LEFT JOIN - incluir usuario aunque no tenga posición
                    }
                ]
            });

            // Verificar si el usuario existe
            if (!userForLogin) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "El usuario ingresado no existe"
                });
            }

            // Verificar contraseña usando el método del modelo
            const passwordMatch = await userForLogin.validatePassword(password);
            if (!passwordMatch) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Contraseña incorrecta"
                });
            }

            // 🔥 LÓGICA PARA PRIMER LOGIN
            const isFirstLogin = userForLogin.last_login === null;

            if (isFirstLogin) {
                // 🔄 TRANSACCIÓN para primer login
                const transaction = await sequelize.transaction();

                try {
                    // Activar usuario
                    await userForLogin.update({
                        status: 'active',
                        session_status: 'online',
                        last_login: new Date() // Hora del servidor
                    }, { transaction });

                    // ✅ Activar solo las relaciones donde es OWNER
                    await user_companies.update(
                        { status: 'active' },
                        {
                            where: {
                                user_id: userForLogin.id,
                                user_type: 'owner',
                                status: 'inactive'
                            },
                            transaction
                        }
                    );

                    // ✅ Activar empresas donde es OWNER (directo, sin FOR)
                    await companies.update(
                        { is_active: true },
                        {
                            where: {
                                id: {
                                    [Op.in]: sequelize.literal(`
                                        (SELECT company_id FROM user_companies 
                                         WHERE user_id = '${userForLogin.id}' 
                                         AND user_type = 'owner')
                                    `)
                                }
                            },
                            transaction
                        }
                    );

                    // Confirmar transacción
                    await transaction.commit();

                } catch (error) {
                    // Rollback en caso de error
                    await transaction.rollback();
                    throw error;
                }
            } else {
                // Login normal - actualizar sesión y last_login
                await userForLogin.update({
                    session_status: 'online',
                    last_login: new Date() // Hora del servidor
                });
            }

            // 🔥 OBTENER TODAS LAS EMPRESAS DEL USUARIO (ENFOQUE UNIFICADO)
            const userCompaniesData = await user_companies.findAll({
                where: {
                    user_id: userForLogin.id,
                    status: 'active'
                },
                include: [
                    {
                        model: companies,
                        as: 'company',
                        attributes: {
                            include: [
                                'id', 'name', 'legal_name', 'tax_id', 'email', 'phone',
                                'address', 'city', 'state', 'country', 'postal_code',
                                'neighborhood', 'logo_url', 'logo_public_id', 'website', 'is_active',
                                // Extraer coordenadas del campo PostGIS ubicacion
                                [sequelize.fn('ST_Y', sequelize.col('company.ubicacion')), 'latitude'],
                                [sequelize.fn('ST_X', sequelize.col('company.ubicacion')), 'longitude']
                            ]
                        }
                    },
                    {
                        model: roles,
                        as: 'role',
                        attributes: ['id', 'name'],
                        include: [
                            {
                                model: permissions,
                                as: 'permissions',
                                through: { attributes: [] }, // Excluir campos de la tabla intermedia
                                attributes: ['name', 'code', 'description', 'is_active']
                            }
                        ]
                    }
                ]
            });

            // 🔥 OBTENER INFORMACIÓN DE LOS OWNERS DE CADA EMPRESA
            const companyIds = userCompaniesData.map(uc => uc.company_id);
            const companyOwnersData = await user_companies.findAll({
                where: {
                    company_id: { [Op.in]: companyIds },
                    user_type: 'owner',
                    status: 'active'
                },
                include: [
                    {
                        model: users,
                        as: 'user',
                        attributes: ['id', 'email']
                    }
                ]
            });

            // 🔥 CREAR MAPA DE OWNERS POR EMPRESA
            const ownersMap = {};
            companyOwnersData.forEach(ownerRelation => {
                const companyId = ownerRelation.company_id;
                const owner = ownerRelation.user;

                ownersMap[companyId] = {
                    id: owner.id,
                    email: owner.email,
                };
            });

            // Formatear empresas con la nueva estructura
            const allUserCompanies = userCompaniesData.map(userCompany => {
                const companyId = userCompany.company.id;
                const owner = ownersMap[companyId] || null;

                // Procesar coordenadas PostGIS - pueden ser null si no hay ubicación
                const latitude = userCompany.company.dataValues?.latitude
                    ? parseFloat(userCompany.company.dataValues.latitude)
                    : null;
                const longitude = userCompany.company.dataValues?.longitude
                    ? parseFloat(userCompany.company.dataValues.longitude)
                    : null;

                //obtener el codigo de pais
                let countryCodeP = null;
                let phoneP = null;

                if (userCompany.company.phone !== null &&
                    userCompany.company.phone !== undefined &&
                    userCompany.company.phone !== '' &&
                    userCompany.company.phone.includes('-')
                ) {
                    countryCodeP = userCompany.company.phone.split('-')[0];
                    phoneP = userCompany.company.phone.split('-')[1];
                }

                return {
                    id: userCompany.company.id,
                    name: userCompany.company.name,
                    legalName: userCompany.company.legal_name,
                    taxId: userCompany.company.tax_id,
                    email: userCompany.company.email,
                    countryCode: countryCodeP,
                    phone: phoneP,
                    address: userCompany.company.address,
                    city: userCompany.company.city,
                    state: userCompany.company.state,
                    country: userCompany.company.country,
                    postalCode: userCompany.company.postal_code,
                    neighborhood: userCompany.company.neighborhood,
                    logoUrl: userCompany.company.logo_url,
                    logoPublicId: userCompany.company.logo_public_id,
                    website: userCompany.company.website,
                    latitude: latitude,
                    longitude: longitude,
                    isActive: userCompany.company.is_active,
                    isDefault: userCompany.is_default,
                    userType: userCompany.user_type, // 'owner' o 'collaborator'  
                    role: {
                        id: userCompany.role.id,
                        name: userCompany.role ? userCompany.role.name : 'COLLABORATOR',
                        description: userCompany.role ? userCompany.role.description : '',
                        permissions: userCompany.role && userCompany.role.permissions
                            ? userCompany.role.permissions.map(permission => ({
                                name: permission.name,
                                code: permission.code,
                                description: permission.description,
                                isActive: permission.is_active
                            }))
                            : []
                    },
                    ownerId: owner ? owner.id : null,
                    ownerEmail: owner ? owner.email : null,

                };
            });

            // 🎯 OBTENER EMPRESA POR DEFECTO para el token específico
            /*🔑 lA TABLA USER_COMPANIES TIENE UN TRIGER QUE CUANDO SE ACTUALIZA  UN CAMPO IS_DEFULT
                  A TRUE, SE ENCARGA DE COLOCAR TODAS LAS DEMAS EMPRESAS DE UN USUARIO A FALSE EN SU IS_DEFAULT,   
                  POR LO QUE UN USUARIO SIEMPRE TENDRA UNA SOLA EMPRESA POR DEFECTO. */
            const defaultCompany = userCompaniesData.find(uc => uc.is_default) || userCompaniesData[0];

            if (!defaultCompany) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: "Usuario sin empresas asignadas"
                });
            }

            // 🔑 GENERAR TOKEN ESPECÍFICO con empresa por defecto
            const token = jwt.sign(
                {
                    userId: userForLogin.id,
                    email: userForLogin.email,
                    companyId: defaultCompany.company_id,
                    roleId: defaultCompany.role_id,
                    userType: defaultCompany.user_type
                },
                SECRET_KEY,
                { expiresIn: '8h' }
            );

            // Procesar el teléfono para separar código de país y número
            let countryCode = undefined;
            let phoneNumber = undefined;

            if (userForLogin.phone) {
                if (userForLogin.phone.includes('-')) {
                    [countryCode, phoneNumber] = userForLogin.phone.split('-');
                } else {
                    phoneNumber = userForLogin.phone;
                }
            }

            // Procesar currentPosition si existe
            let currentPosition = null;
            if (userForLogin.current_position && userForLogin.current_position.is_active) {
                try {
                    // Verificar que position existe y tiene coordenadas
                    if (userForLogin.current_position.position && userForLogin.current_position.position.coordinates) {
                        const coordinates = userForLogin.current_position.position.coordinates;

                        // Verificar que las coordenadas son válidas
                        if (Array.isArray(coordinates) && coordinates.length >= 2) {
                            currentPosition = {
                                id: userForLogin.current_position.id, // Ya es INTEGER, no necesita conversión
                                latitude: parseFloat(coordinates[1]) || 0, // PostGIS almacena como [lng, lat]
                                longitude: parseFloat(coordinates[0]) || 0,
                                accuracy: parseFloat(userForLogin.current_position.accuracy) || 0
                            };
                        }
                    }
                } catch (coordError) {
                    console.warn("⚠️ Error procesando coordenadas para usuario:", userForLogin.id, coordError);
                    currentPosition = null;
                }
            }

            // Preparar objeto de usuario para la respuesta
            const user = {
                id: userForLogin.id,
                email: userForLogin.email,
                name: userForLogin.first_name,
                lastName: userForLogin.last_name,
                imageUrl: userForLogin.image_url,
                imagePublicId: userForLogin.image_public_id,
                countryCode: countryCode,
                phone: phoneNumber,
                status: userForLogin.status,
                requireGeolocation: userForLogin.require_geolocation,
                sessionStatus: userForLogin.session_status,
                lastLogin: userForLogin.last_login,
                currentPosition: currentPosition, // Incluir posición actual o null
                companies: allUserCompanies // ✅ Empresas con roles y permisos específicos
            };

            // Enviar respuesta exitosa
            return res.status(200).json({
                success: true,
                status: 200,
                message: "Login exitoso",
                token,
                user
            });

        } catch (error) {
            console.error("❌ Error en login:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // 📌 Actualizar un usuario por ID
    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, lastName, phone } = req.body;

            const user = await users.findByPk(id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Usuario no encontrado"
                });
            }

            // Validar teléfono único si se está actualizando
            let phoneToUpdate = null;
            if (phone) {
                phoneToUpdate = phone;

                if (phoneToUpdate !== user.phone) {
                    const phoneExists = await users.findOne({
                        where: {
                            phone: phoneToUpdate,
                            id: { [Op.ne]: id } // Excluir el usuario actual
                        }
                    });

                    if (phoneExists) {
                        return res.status(400).json({
                            success: false,
                            status: 400,
                            message: "El teléfono ya está en uso por otro usuario"
                        });
                    }
                }
            }

            // Preparar datos para actualización
            const updateData = {};

            if (name) updateData.first_name = name;
            if (lastName) updateData.last_name = lastName;
            //no se debe actualizar el email, ya que es unico y se debe validar en el front
            //if (email) updateData.email = email;
            if (phoneToUpdate) updateData.phone = phoneToUpdate;


            // Actualizar usuario
            await user.update(updateData);


            // Procesar el teléfono para la respuesta
            let responseCountryCode = undefined;
            let responsePhoneNumber = undefined;

            if (user.phone) {
                if (user.phone.includes('-')) {
                    [responseCountryCode, responsePhoneNumber] = user.phone.split('-');
                } else {
                    responsePhoneNumber = user.phone;
                }
            }

            // Preparar respuesta sin contraseña
            const userResponse = {
                id: user.id,
                countryCode: responseCountryCode,
                currentPosition: user.current_position,
                email: user.email,
                imageUrl: user.image_url,
                imagePublicId: user.image_public_id,
                lastName: user.last_name,
                name: user.first_name,
                phone: responsePhoneNumber,
                requireGeolocation: user.require_geolocation,
                status: user.status,
                sessionStatus: user.session_status,
                lastLogin: user.last_login,
            };

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Usuario actualizado exitosamente",
                user: userResponse
            });

        } catch (error) {
            console.error("❌ Error actualizando usuario:", error);

            // Manejo específico de errores de validación de Sequelize
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`
                });
            }

            // Manejo específico de errores de restricción única
            if (error.name === 'SequelizeUniqueConstraintError') {
                if (error.original && error.original.constraint) {
                    switch (error.original.constraint) {
                        case 'users_email_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El email ya está registrado en el sistema"
                            });
                        case 'users_phone_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El teléfono ya está registrado en el sistema"
                            });
                        default:
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "Ya existe un registro con estos datos"
                            });
                    }
                }
            }

            // Error genérico
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al actualizar usuario"
            });
        }
    },

    // 📌 Actualizar contraseña de usuario
    async updatePassword(req, res) {
        try {
            // 🔑 Obtener los datos del usuario y la nueva contraseña desde el body de la solicitud
            const { id } = req.params;
            const { currentPassword, newPassword } = req.body;

            // 🔑 Validar que los campos requeridos estén presentes y que la nueva contraseña tenga al menos 8 caracteres
            if (!currentPassword || !newPassword || newPassword.length < 8 || !id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ups! Algo salió mal, por favor intenta nuevamente."
                });
            }

            // 🔑 Validar que la contraseña actual y la nueva contraseña sean diferentes
            if (currentPassword === newPassword) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Escoja una contraseña diferente, que no haya usado antes."
                });
            }

            // 🔑 Buscar el usuario por su ID
            const user = await users.findByPk(id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Usuario no encontrado"
                });
            }



            // 🔑 Validar que la contraseña actual sea correcta
            const passwordMatch = await user.validatePassword(currentPassword);
            if (!passwordMatch) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ups! algo salió mal, por favor intenta nuevamente."
                });
            }

            // 🔑 Actualizar la contraseña del usuario (el hook del modelose encarga del hash)
            await user.update({ password: newPassword });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Contraseña actualizada exitosamente"
            });

        } catch (error) {

            // Manejo específico de errores de validación de Sequelize
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`
                });
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al actualizar contraseña"
            });
        }
    },

    // 📌 Crear un usuario
    async createUser(req, res) {
        let newUser = null;
        let newUserCompany = null;
        let transaction = null;
        let plainPassword = null;

        try {
            const { name, lastName, email, phone, roleId, requireGeolocation, companyId, allowAccess } = req.body;

            // 1. Validar que todos los campos requeridos estén presentes
            if (!name || !lastName || !email || !phone || !roleId || !companyId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos para crear el usuario"
                });
            }

            // 2. Verificar si el email ya existe (fuera de transacción)
            const existingUser = await users.findOne({ where: { email } });
            if (existingUser) {

                // Verificar si ya tiene relación con esta empresa
                const existingRelation = await user_companies.findOne({
                    where: {
                        user_id: existingUser.id,
                        company_id: companyId
                    },
                    include: [{
                        model: roles,
                        as: 'role',
                        attributes: ['id', 'name', 'label']
                    }]
                });

                if (existingRelation) {
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        message: 'El usuario que intenta crear ya se encuentra registrado en su compañía',
                        existingUser: false
                    });
                }

                // Usuario existe pero no tiene relación con esta empresa
                return res.status(409).json({
                    success: false,
                    status: 409,
                    message: 'El usuario ya existe en el sistema',
                    existingUser: true,
                    userFound: {
                        id: existingUser.id,
                        email: existingUser.email,
                        name: existingUser.first_name,
                        lastName: existingUser.last_name,
                        phone: existingUser.phone,
                        status: existingUser.status,
                        imageUrl: existingUser.image_url,

                    },
                    userDataToCreate: {
                        name,
                        lastName,
                        email,
                        phone,
                        roleId,
                        requireGeolocation,
                        companyId,
                        allowAccess,
                    }
                });
            }

            // 3. Verificar si el teléfono ya existe (fuera de transacción)
            const existingPhone = await users.findOne({ where: { phone } });
            if (existingPhone) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El teléfono proporcionado ya está en uso'
                });
            }

            // 4. Verificar que la empresa existe
            const company = await companies.findByPk(companyId);
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Empresa no encontrada'
                });
            }

            // 5. Verificar que el rol existe
            const roleData = await roles.findByPk(roleId);
            if (!roleData) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'El cargo asignado no existe'
                });
            }

            // 6. Determinar el tipo de usuario basado en el rol
            const userType = (roleData.name === 'OWNER') ? 'owner' : 'collaborator';

            // 7. Generar contraseña provisional
            const crypto = require('crypto');
            plainPassword = crypto.randomBytes(8).toString('hex');

            // 8. Iniciar transacción
            transaction = await sequelize.transaction();

            try {
                // 8.1 Crear el usuario con estado inactive
                newUser = await users.create({
                    email,
                    password: plainPassword, // Se hashea automáticamente en el hook del modelo users
                    first_name: name,
                    last_name: lastName,
                    phone,
                    require_geolocation: requireGeolocation || false,
                    status: 'inactive' // Usuario inactivo hasta primer login
                }, { transaction });


                // 8.2 Crear la relación user_companies
                newUserCompany = await user_companies.create({
                    user_id: newUser.id,
                    company_id: companyId,
                    role_id: roleId,
                    user_type: userType,
                    is_default: true,
                    status: allowAccess,
                }, { transaction });


                const welcomeEmailData = {
                    email: newUser.email,
                    fullName: `${name} ${lastName}`,
                    companyName: company.name,
                    password: plainPassword // Enviamos la contraseña sin hashear
                };


                const emailSent = await sendWelcomeEmail(welcomeEmailData);

                if (!emailSent) {
                    await transaction.rollback();

                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al enviar el email de bienvenida. El usurio no fue creado.'
                    });
                }

                await transaction.commit();


                // 10. Respuesta exitosa
                return res.status(201).json({
                    success: true,
                    status: 201,
                    message: 'Usuario creado exitosamente. Se ha enviado un email con las credenciales de acceso.',
                    existingUser: false,
                    user: {
                        id: newUser.id,
                        email: newUser.email,
                        name: newUser.first_name,
                        lastName: newUser.last_name,
                        countryCode: newUser.phone.split('-')[0],
                        phone: newUser.phone.split('-')[1],
                        imageUrl: newUser.image_url,
                        imagePublicId: newUser.image_public_id,
                        userStatus: newUser.status,
                        role: {
                            id: roleData.id,
                            name: roleData.name,
                            label: roleData.label
                        },
                        allowAccess: newUserCompany.status,
                        userType: newUserCompany.user_type,
                        requireGeolocation: newUser.require_geolocation
                    }
                });

            } catch (innerError) {
                // Si algo falla durante la transacción, hacemos rollback
                if (transaction) await transaction.rollback();

                throw innerError;
            }

        } catch (error) {


            // Manejar diferentes tipos de errores
            let statusCode = 500;
            let message = 'Error interno del servidor al crear usuario';

            if (error.name === 'SequelizeValidationError') {
                statusCode = 400;
                message = 'Error de validación: ' + error.errors.map(err => err.message).join(', ');
            } else if (error.name === 'SequelizeUniqueConstraintError') {
                statusCode = 400;
                if (error.original && error.original.constraint) {
                    switch (error.original.constraint) {
                        case 'users_email_key':
                            message = 'El email ya está registrado en el sistema';
                            break;
                        case 'users_phone_key':
                            message = 'El teléfono ya está registrado en el sistema';
                            break;
                        default:
                            message = 'Ya existe un registro con estos datos';
                    }
                }
            }

            return res.status(statusCode).json({
                success: false,
                status: statusCode,
                message: message
            });
        }
    },

    // 📌 Asignar usuario existente a empresa
    async createExistingUser(req, res) {
        let transaction = null;

        try {
            const { userFound, userDataToCreate } = req.body;

            // 1. Validar que todos los campos requeridos estén presentes
            if (!userFound || !userDataToCreate || !userFound.id || !userDataToCreate.companyId || !userDataToCreate.roleId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos para asignar el usuario"
                });
            }

            // 2. Verificar que el usuario existe
            const existingUser = await users.findByPk(userFound.id);
            if (!existingUser) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Usuario no encontrado'
                });
            }

            // 3. Verificar que la empresa existe
            const company = await companies.findByPk(userDataToCreate.companyId);
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Empresa no encontrada'
                });
            }

            // 4. Verificar que el rol existe
            const roleData = await roles.findByPk(userDataToCreate.roleId);
            if (!roleData) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'El cargo asignado no existe'
                });
            }

            // 5. Verificar que no exista una relación activa
            const existingRelation = await user_companies.findOne({
                where: {
                    user_id: userFound.id,
                    company_id: userDataToCreate.companyId
                }
            });

            if (existingRelation) {
                if (existingRelation.status === 'active') {
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        message: 'El usuario ya está activo en esta empresa'
                    });
                } else {
                    // Reactivar relación existente
                    await existingRelation.update({
                        role_id: userDataToCreate.roleId,
                        status: userDataToCreate.allowAccess,
                        user_type: (roleData.name === 'OWNER' || roleData.name === 'owner') ? 'owner' : 'collaborator'
                    });

                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Usuario reactivado exitosamente en la empresa',
                        user: {
                            id: existingUser.id,
                            email: existingUser.email,
                            name: existingUser.first_name,
                            lastName: existingUser.last_name,
                            countryCode: existingUser.phone.split('-')[0],
                            phone: existingUser.phone.split('-')[1],
                            imageUrl: existingUser.image_url,
                            imagePublicId: existingUser.image_public_id,
                            userStatus: existingUser.status,
                            userType: (roleData.name === 'OWNER') ? 'owner' : 'collaborator',
                            role: {
                                id: roleData.id,
                                name: roleData.name,
                                label: roleData.label
                            },
                            allowAccess: existingRelation.status,
                            userType: existingRelation.user_type,
                            requireGeolocation: existingUser.require_geolocation
                        }
                    });
                }
            }

            // 6. Determinar el tipo de usuario basado en el rol
            const userType = (roleData.name === 'OWNER') ? 'owner' : 'collaborator';
            console.log(`👤 [UserController] Rol asignado: ${roleData.name}, Tipo usuario: ${userType}`);

            // 7. Actualizar datos del usuario si es necesario
            existingUser.require_geolocation = userDataToCreate.requireGeolocation || existingUser.require_geolocation;
            await existingUser.save();

            // 8. Iniciar transacción para crear la relación
            transaction = await sequelize.transaction();

            try {
                // 8.1 Crear la relación user_companies
                await user_companies.create({
                    user_id: existingUser.id,
                    company_id: userDataToCreate.companyId,
                    role_id: userDataToCreate.roleId,
                    user_type: userType,
                    is_default: true, // No es empresa por defecto ya que el usuario ya existe
                    status: userDataToCreate.allowAccess // Usuario existente se activa inmediatamente
                }, { transaction });

                // 8.2 Confirmar la transacción
                await transaction.commit();

                // 9. Respuesta exitosa
                return res.status(201).json({
                    success: true,
                    status: 201,
                    message: 'Usuario asignado exitosamente.',
                    user: {
                        id: existingUser.id,
                        email: existingUser.email,
                        name: existingUser.first_name,
                        lastName: existingUser.last_name,
                        phone: existingUser.phone,
                        status: existingUser.status,
                        userType: userType,
                        role: {
                            id: roleData.id,
                            name: roleData.name,
                            label: roleData.label
                        }
                    }
                });

            } catch (innerError) {
                // Si algo falla durante la transacción, hacemos rollback
                if (transaction) await transaction.rollback();
                throw innerError;
            }

        } catch (error) {

            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al asignar usuario'
            });
        }
    },

    // 📌 Obtener usuarios por compañía
    async getUsersByCompany(req, res) {
        try {
            const { company_id } = req.params;

            // Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    users: []
                });
            }

            // Obtener usuarios desde user_companies
            const usersList = await user_companies.findAll({
                where: {
                    company_id: company_id
                },
                include: [
                    {
                        model: users,
                        as: 'user',
                        attributes: [
                            "id",
                            "email",
                            "first_name",
                            "last_name",
                            "phone",
                            "require_geolocation",
                            "image_url",
                            "image_public_id",
                            "status"
                        ]
                    },
                    {
                        model: roles,
                        as: 'role',
                        attributes: ["id", "name", "label"]
                    }
                ]
            });

            // Formatear respuesta
            const formattedUsers = usersList.map(userCompany => {
                const user = userCompany.user;

                // Procesar el teléfono para separar código de país y número
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (user.phone) {
                    if (user.phone.includes('-')) {
                        [countryCode, phoneNumber] = user.phone.split('-');
                    } else {
                        phoneNumber = user.phone;
                    }
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.first_name,
                    lastName: user.last_name,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    imageUrl: user.image_url,
                    imagePublicId: user.image_public_id,
                    userStatus: user.status,
                    role: {
                        id: userCompany.role.id,
                        name: userCompany.role.name,
                        label: userCompany.role.label
                    },
                    allowAccess: userCompany.status,
                    userType: userCompany.user_type,
                    requireGeolocation: user.require_geolocation
                };
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Usuarios obtenidos exitosamente",
                users: formattedUsers
            });

        } catch (error) {
            console.error("❌ Error al obtener usuarios:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error al obtener usuarios de la compañía",
                users: []
            });
        }
    },

    // 📌 Actualizar usuarios de compañía
    async updateUsersOfCompany(req, res) {
        try {
            const { id } = req.params;
            const { name, lastName, phone, roleId, allowAccess, requireGeolocation, companyId } = req.body;

            //1. Validar que todos los campos requeridos estén presentes
            if (!name || !lastName || !phone || !roleId || !allowAccess || !companyId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos para actualizar el usuario"
                });
            }

            //2. Buscar el usuario en la base de datos
            const userInDB = await users.findByPk(id);
            if (!userInDB) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Usuario no encontrado"
                });
            }

            //3. Buscar la empresa en la base de datos
            const companyInDB = await companies.findByPk(companyId);
            if (!companyInDB) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Empresa no encontrada"
                });
            }

            //4. Boscar la relacion de user_companies
            const userCompanyInDB = await user_companies.findOne({
                where: {
                    user_id: id,
                    company_id: companyId
                }
            });

            if (!userCompanyInDB) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "El usuario que intentas actualizar no esta asignado a esta compañía"
                });
            }

            // 5. Buscar el rol en la base de datos
            const roleInDB = await roles.findByPk(roleId);
            if (!roleInDB) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "El rol que intentas asignar no existe"
                });
            }

            // 6. Iniciar transaccion (declarar fuera del try para acceso en catch)
            let transaction = null;
            transaction = await sequelize.transaction();

            const userType = roleInDB.name === 'OWNER' ? 'owner' : 'collaborator';


            try {
                // 6. Actualizar los datos del usuario
                const updatedUser = await userInDB.update({
                    first_name: name,
                    last_name: lastName,
                    phone: phone,
                    require_geolocation: requireGeolocation
                }, { transaction });

                // 7. Actualizar la relacion de user_companies
                const updatedUserCompany = await userCompanyInDB.update({
                    role_id: roleId,
                    status: allowAccess,
                    user_type: userType
                }, { transaction });



                if (!updatedUserCompany) {
                    await transaction.rollback();
                    return res.status(404).json({
                        success: false,
                        status: 404,
                        message: "Error al actualizar el usuario, por favor intenta nuevamente"
                    });
                }

                // 8. Confirmar la transaccion
                await transaction.commit();

                const countryCode = updatedUser.phone.split('-')[0];
                const phoneNumber = updatedUser.phone.split('-')[1];

                // Formatear la respuesta
                const formattedUser = {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.first_name,
                    lastName: updatedUser.last_name,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    imageUrl: updatedUser.image_url,
                    imagePublicId: updatedUser.image_public_id,
                    userStatus: updatedUser.status,
                    role: {
                        id: roleInDB.id,
                        name: roleInDB.name,
                        label: roleInDB.label
                    },
                    allowAccess: updatedUserCompany.status,
                    userType: updatedUserCompany.user_type,
                    requireGeolocation: updatedUser.require_geolocation
                }

                // 9. Respuesta exitosa
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: "Usuario actualizado exitosamente",
                    user: formattedUser
                });

            } catch (innerError) {
                await transaction.rollback();
                console.error("❌ Error en transacción:", innerError);
                throw innerError;
            }

        } catch (error) {
            if (transaction) await transaction.rollback();

            console.error("❌ Error al actualizar usuarios de la compañía:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error al actualizar usuario de la compañía",
            });
        }
    },




    /*----------------------------------------------------METODOS QUE NO SE ESTAN USANDO AUN ----------------------------------------*/



    // 📌 Obtener todos los usuarios
    async list(req, res) {
        console.log("📌 Llegó a la función list");
        try {
            const allUsers = await users.findAll();
            res.status(200).json(allUsers);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 Obtener todos los usuarios vendedores de una compañía específica
    async getSellers(req, res) {
        console.log("📌 Intentando obtener vendedores de una compañía...", req.params);

        try {
            const { company_id } = req.params;

            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    sellers: []
                });
            }

            // 🔹 Buscar el rol de vendedor por nombre
            const sellerRole = await roles.findOne({
                where: { name: 'SELLER' }
            });

            if (!sellerRole) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Rol de vendedor no encontrado en el sistema",
                    sellers: []
                });
            }

            // Obtener vendedores desde user_companies
            const sellersList = await user_companies.findAll({
                where: {
                    company_id: company_id,
                    role_id: sellerRole.id,
                    status: 'active'
                },
                include: [
                    {
                        model: users,
                        as: 'user',
                        where: { status: 'active' },
                        attributes: ["id", "email", "first_name", "last_name", "phone", "status"]
                    },
                    {
                        model: roles,
                        as: 'role',
                        attributes: ["id", "name"],
                        include: [
                            {
                                model: permissions,
                                as: 'permissions',
                                through: { attributes: [] }, // Excluir campos de la tabla intermedia
                                attributes: ['name', 'code', 'description', 'is_active']
                            }
                        ]
                    }
                ]
            });

            // 🔹 Si no hay vendedores, devolver lista vacía (no es un error)
            if (!sellersList.length) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: "No hay vendedores asignados a esta compañía aún",
                    sellers: []
                });
            }

            // 🔹 Formatear respuesta simplificada
            const formattedSellers = sellersList.map(userCompany => {
                const seller = userCompany.user;

                // Procesar el teléfono para separar código de país y número
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (seller.phone) {
                    if (seller.phone.includes('-')) {
                        [countryCode, phoneNumber] = seller.phone.split('-');
                    } else {
                        phoneNumber = seller.phone;
                    }
                }

                return {
                    id: seller.id,
                    email: seller.email,
                    name: seller.first_name,
                    lastName: seller.last_name,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    status: seller.status,
                    userType: userCompany.user_type,
                    role: {
                        id: userCompany.role ? parseInt(userCompany.role.id) || 0 : 0,
                        name: userCompany.role ? userCompany.role.name : 'COLLABORATOR',
                        permissions: userCompany.role && userCompany.role.permissions
                            ? userCompany.role.permissions.map(permission => ({
                                name: permission.name,
                                code: permission.code,
                                description: permission.description,
                                isActive: permission.is_active
                            }))
                            : []
                    }
                };
            });

            console.log(`✅ Vendedores obtenidos para compañía ${company_id}:`, formattedSellers.length);

            res.status(200).json({
                success: true,
                status: 200,
                message: "Vendedores obtenidos exitosamente",
                sellers: formattedSellers
            });

        } catch (error) {
            console.error("❌ Error al obtener vendedores:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al obtener vendedores de la compañía",
                sellers: []
            });
        }
    },

    // 📌 Obtener un usuario por ID
    async getById(req, res) {
        try {
            const { id } = req.params;
            const user = await users.findByPk(id);

            if (!user) {
                return res.status(404).json({ message: "Usuario no encontrado" });
            }

            res.status(200).json(user);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 Crear un usuario
    async create(req, res) {
        try {
            console.log("➡️ POST /api/users - Datos recibidos:", req.body);

            if (!req.body || Object.keys(req.body).length === 0) {
                console.log("⚠️ El body está vacío");
                return res.status(400).json({ message: "El cuerpo de la solicitud no puede estar vacío" });
            }

            const { password, email, first_name, last_name, phone } = req.body;

            // Hashear la contraseña antes de guardar
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

            const newUser = await users.create({
                password: hashedPassword,
                email,
                first_name,
                last_name,
                phone
            });

            console.log("✅ Usuario creado:", newUser);
            res.status(201).json(newUser);
        } catch (error) {
            console.error("❌ Error en createUser:", error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // 📌 Eliminar un usuario por ID
    async delete(req, res) {
        try {
            const { id } = req.params;

            const user = await users.findByPk(id);
            if (!user) {
                return res.status(404).json({ message: "Usuario no encontrado" });
            }

            await user.destroy();
            res.status(200).json({ message: "Usuario eliminado correctamente" });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 CAMBIAR EMPRESA POR DEFECTO
    async setDefaultCompany(req, res) {
        try {
            const { companyId } = req.params;
            const userId = req.user?.id; // Asumiendo middleware JWT

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: "Usuario no autenticado"
                });
            }

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "ID de empresa requerido"
                });
            }

            // Verificar que el usuario tiene acceso a esta empresa
            const userCompany = await user_companies.findOne({
                where: {
                    user_id: userId,
                    company_id: companyId,
                    status: 'active'
                },
                include: [{
                    model: companies,
                    as: 'company',
                    attributes: ['id', 'name']
                }]
            });

            if (!userCompany) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "No tienes acceso a esta empresa"
                });
            }

            // Establecer como empresa por defecto
            await userCompany.setAsDefault();

            return res.status(200).json({
                success: true,
                status: 200,
                message: `Empresa "${userCompany.company.name}" establecida como predeterminada`,
                data: {
                    companyId: companyId,
                    companyName: userCompany.company.name,
                    isDefault: true
                }
            });

        } catch (error) {
            console.error("❌ Error al cambiar empresa por defecto:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // 📌 LOGOUT DE USUARIO
    async logout(req, res) {
        try {
            const userId = req.user?.id; // Desde middleware JWT

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: "Usuario no autenticado"
                });
            }

            // Actualizar estado de sesión
            await users.update(
                {
                    session_status: 'offline'
                },
                { where: { id: userId } }
            );

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Logout exitoso"
            });

        } catch (error) {
            console.error("❌ Error en logout:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // �� ESTADÍSTICAS DE USUARIOS
    async getUserStats(req, res) {
        try {
            const stats = await users.findAll({
                attributes: [
                    [sequelize.fn('COUNT', sequelize.col('id')), 'total_users'],
                    [sequelize.fn('COUNT', sequelize.literal("CASE WHEN last_login IS NULL THEN 1 END")), 'never_logged_in'],
                    [sequelize.fn('COUNT', sequelize.literal("CASE WHEN last_login IS NOT NULL THEN 1 END")), 'active_users'],
                    [sequelize.fn('COUNT', sequelize.literal("CASE WHEN session_status = 'online' THEN 1 END")), 'currently_online'],
                    [sequelize.fn('COUNT', sequelize.literal("CASE WHEN status = 'inactive' THEN 1 END")), 'inactive_users']
                ],
                raw: true
            });

            // Obtener usuarios fantasma (registrados hace más de 7 días sin login)
            const ghostUsers = await users.count({
                where: {
                    last_login: null,
                    created_at: {
                        [Op.lt]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    }
                }
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Estadísticas obtenidas exitosamente",
                data: {
                    ...stats[0],
                    ghost_users: ghostUsers,
                    conversion_rate: stats[0].total_users > 0
                        ? ((stats[0].active_users / stats[0].total_users) * 100).toFixed(2) + '%'
                        : '0%'
                }
            });

        } catch (error) {
            console.error("❌ Error obteniendo estadísticas:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // 📌 CAMBIAR EMPRESA ACTIVA (regenerar token)
    async switchActiveCompany(req, res) {
        try {
            const { companyId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: "Usuario no autenticado"
                });
            }

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "ID de empresa requerido"
                });
            }

            // Verificar que el usuario tiene acceso a esta empresa
            const userCompany = await user_companies.findOne({
                where: {
                    user_id: userId,
                    company_id: companyId,
                    status: 'active'
                },
                include: [
                    {
                        model: companies,
                        as: 'company',
                        attributes: ['id', 'name']
                    },
                    {
                        model: roles,
                        as: 'role',
                        include: [{
                            model: permissions,
                            as: 'permissions',
                            through: { attributes: [] },
                            attributes: ['code', 'name']
                        }]
                    }
                ]
            });

            if (!userCompany) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "No tienes acceso a esta empresa"
                });
            }

            // 🔑 REGENERAR TOKEN con nueva empresa (como nuevo login)
            const newToken = jwt.sign(
                {
                    userId: userId,
                    email: req.user.email,
                    companyId: userCompany.company_id,
                    roleId: userCompany.role_id,
                    userType: userCompany.user_type
                },
                SECRET_KEY,
                { expiresIn: '8h' }
            );

            // Formatear información de la empresa activa
            const activeCompany = {
                id: userCompany.company_id,
                name: userCompany.company.name,
                userType: userCompany.user_type,
                role: userCompany.role ? userCompany.role.name : 'COLLABORATOR',
                permissions: userCompany.role && userCompany.role.permissions
                    ? userCompany.role.permissions.map(p => ({
                        code: p.code,
                        name: p.name
                    }))
                    : []
            };

            return res.status(200).json({
                success: true,
                status: 200,
                message: `Empresa activa cambiada a "${userCompany.company.name}"`,
                data: {
                    token: newToken, // ✅ Nuevo token específico
                    activeCompany: activeCompany
                }
            });

        } catch (error) {
            console.error("❌ Error al cambiar empresa activa:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },


};

