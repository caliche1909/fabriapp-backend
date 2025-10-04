const { stores, users, store_visits, roles } = require('../models');
const { Op } = require('sequelize'); // ✅ Importar Op de Sequelize
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

module.exports = {

    // 📌 Método para crear una tienda con o sin usuario (TRANSACCIONAL)
    async createStore(req, res) {
        // 🔄 Iniciar transacción para garantizar atomicidad
        const transaction = await stores.sequelize.transaction();

        try {
            // 🔸 PASO 1: Extraer company_id de los parámetros y datos del request body
            const { company_id } = req.params;
            const { store, user } = req.body;


            // 🔸 PASO 2: Validar que company_id esté presente en la URL
            if (!company_id) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se puede validar la compañia",
                });
            }

            // 🔸 PASO 3: Validar que vengan los datos mínimos de la tienda
            const { name, address, store_type_id, neighborhood, latitude, longitude, route_id } = store || {};



            if (!name || !address || !store_type_id || !neighborhood) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos esenciales para crear la tienda.",
                });
            }

            // 🔸 PASO 4: Asignar company_id al objeto store
            store.company_id = company_id;

            // 🔸 PASO 4.1: Asignar route_id si viene del frontend
            if (route_id) {
                // Validar que la ruta existe y pertenece a la misma compañía
                const route = await stores.sequelize.models.routes.findOne({
                    where: {
                        id: route_id,
                        company_id: company_id
                    },
                    transaction
                });

                if (!route) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "La ruta especificada no existe o no pertenece a esta compañía.",
                    });
                }

                store.route_id = route_id;
            }

            // 🔸 PASO 4.2: Convertir latitude/longitude a campo PostGIS ubicacion
            if (latitude && longitude) {
                // Validar que sean números válidos
                const lat = parseFloat(latitude);
                const lng = parseFloat(longitude);

                if (!isNaN(lat) && !isNaN(lng)) {
                    // Crear punto PostGIS usando ST_SetSRID y ST_MakePoint
                    // Nota: ST_MakePoint recibe (longitude, latitude) - el orden importa!
                    store.ubicacion = stores.sequelize.fn('ST_SetSRID',
                        stores.sequelize.fn('ST_MakePoint', lng, lat),
                        4326
                    );
                }
            }

            // 🔸 PASO 5: Procesar y limpiar nombre y barrio
            store.name = store.name.trim().replace(/\s+/g, ' ').toUpperCase();
            store.neighborhood = store.neighborhood
                .trim()
                .replace(/\s+/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            // 🔸 PASO 6: Validar duplicado por dirección en la misma compañía
            // (no pueden existir dos tiendas en la misma dirección de la misma compañía)
            const existingStore = await stores.findOne({
                where: {
                    address: store.address,
                    company_id: company_id
                },
                transaction
            });

            if (existingStore) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "La tienda que intenta crear YA EXISTE!",
                });
            }

            // 🔸 PASO 7: Si llegaron datos del nuevo usuario manager, validar y crear usuario
            if (user) {
                // Verificar que el email no esté en uso
                const existingUser = await users.findOne({
                    where: { email: user.email },
                    transaction
                });
                if (existingUser) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "El email del manager ya está registrado en el sistema.",
                    });
                }

                // Verificar que el teléfono no esté en uso
                const phoneToCheck = user.countryCode ? `${user.countryCode}-${user.phone}` : user.phone;
                const existingUserByPhone = await users.findOne({
                    where: { phone: phoneToCheck },
                    transaction
                });
                if (existingUserByPhone) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "El teléfono del administrador de la tienda ya esta en uso",
                    });
                }

                // 🔍 Buscar el rol STORE_MANAGER dinámicamente
                const storeManagerRole = await roles.findOne({
                    where: { name: 'STORE_MANAGER' },
                    transaction
                });

                if (!storeManagerRole) {
                    await transaction.rollback();
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: "Ups! No se pudo crear el manager de la tienda.",
                    });
                }

                // Crear nuevo usuario manager dentro de la transacción
                const password = user.password || "FabriApp.2025";
                const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

                const newUser = await users.create({
                    first_name: user.name.split(' ')[0] || 'Desconocido',
                    last_name: user.name.split(' ')[1] || 'Desconocido',
                    email: user.email,
                    phone: user.countryCode ? `${user.countryCode}-${user.phone}` : user.phone,
                    role_id: storeManagerRole.id, // ✅ Usar UUID del rol STORE_MANAGER
                    password: hashedPassword,
                    status: user.status || "inactive"
                }, { transaction });

                // Asignar el ID del nuevo usuario como manager de la tienda
                store.manager_id = newUser.id;
            }

            // 🔸 PASO 8: Crear la tienda en la base de datos dentro de la transacción
            const newStore = await stores.create(store, { transaction });

            // 🔸 PASO 9: Consultar la tienda recién creada con todas sus relaciones
            const createdStore = await stores.findOne({
                where: { id: newStore.id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id', // Incluir company_id en la respuesta
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
                    'current_visit_status'
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    }
                ],
                transaction
            });

            // 🔸 PASO 10: Formatear respuesta para satisfacer la interfaz Store del frontend
            const storeData = createdStore.toJSON();

            // Formatear manager si existe para satisfacer interfaz User
            if (storeData.manager) {
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (storeData.manager.phone) {
                    if (storeData.manager.phone.includes('-')) {
                        [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                    } else {
                        phoneNumber = storeData.manager.phone;
                    }
                }

                storeData.manager = {
                    id: storeData.manager.id,
                    name: storeData.manager.first_name,
                    lastName: storeData.manager.last_name,
                    email: storeData.manager.email,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    status: storeData.manager.status
                };
            }

            // Agregar array de imágenes vacío para satisfacer interfaz Store
            storeData.images = [];

            // 🔸 PASO 11: Confirmar transacción y devolver respuesta exitosa
            await transaction.commit();

            return res.status(201).json({
                success: true,
                status: 201,
                message: "Tienda creada exitosamente",
                store: storeData
            });

        } catch (error) {
            // 🚨 Rollback en caso de error
            await transaction.rollback();

            // 🔍 Manejo específico de errores de restricción única
            if (error.name === 'SequelizeUniqueConstraintError') {
                if (error.original && error.original.constraint) {
                    switch (error.original.constraint) {
                        case 'users_email_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El email del ADMIN ya está registrado en el sistema.",
                            });
                        case 'users_phone_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El teléfono del ADMIN ya está registrado en el sistema.",
                            });
                        case 'idx_stores_company_address_unique':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "Ya existe una tienda registrada en esta dirección para su compañía.",
                            });
                        default:
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "Ya existe un registro con estos datos.",
                            });
                    }
                }
            }

            // 🔍 Manejo específico de errores de validación
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`,
                });
            }

            // Error genérico para otros casos
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al crear la tienda.",
            });
        }
    },

    // 📌 Método para actualizar una tienda por id
    async updateStore(req, res) {
        const { id } = req.params;
        const { newStore, newUser } = req.body;


        // 🔄 Iniciar transacción para garantizar atomicidad
        const transaction = await stores.sequelize.transaction();

        try {
            // Verificar si la tienda existe
            const store = await stores.findByPk(id, { transaction });
            if (!store) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "Tienda no encontrada."
                });
            }


            // Extraer todos los campos necesarios del body
            let {
                name,
                address,
                phone,
                neighborhood,
                route_id,
                latitude,
                longitude,
                opening_time,
                closing_time,
                city,
                state,
                country,
                store_type_id
            } = newStore;



            // Validar que los campos obligatorios estén presentes
            if (!name || !address || !store_type_id || !neighborhood) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos obligatorios para actualizar la tienda."
                });
            }

            // 🔸 Validar que no exista otra tienda con la misma dirección (solo si se está cambiando la dirección)
            if (address !== store.address) {
                const existingStore = await stores.findOne({
                    where: {
                        address: address,
                        company_id: store.company_id,
                        id: { [Op.ne]: id } // ✅ Excluir la tienda actual
                    },
                    transaction
                });

                if (existingStore) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Ya existe otra tienda registrada en la dirección indicada.",
                    });
                }
            }

            // 🔸 PASO 5: Procesar y limpiar nombre y barrio (igual que createStore)
            store.name = name.trim().replace(/\s+/g, ' ').toUpperCase();
            store.neighborhood = neighborhood
                .trim()
                .replace(/\s+/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            // Actualizar los campos de la tienda (manteniendo los que no se envían)
            store.address = address || store.address;
            store.phone = phone || store.phone;
            store.route_id = route_id !== undefined ? route_id : store.route_id;

            // 🗺️ Actualizar ubicación PostGIS si llegan coordenadas
            if (latitude && longitude) {
                const lat = parseFloat(latitude);
                const lng = parseFloat(longitude);

                if (!isNaN(lat) && !isNaN(lng)) {
                    // Crear punto PostGIS usando ST_SetSRID y ST_MakePoint
                    store.ubicacion = stores.sequelize.fn('ST_SetSRID',
                        stores.sequelize.fn('ST_MakePoint', lng, lat),
                        4326
                    );
                }
            }

            store.opening_time = opening_time || store.opening_time;
            store.closing_time = closing_time || store.closing_time;
            store.city = city || store.city;
            store.state = state || store.state;
            store.country = country || store.country;
            store.store_type_id = store_type_id || store.store_type_id;

            // 🔸 PASO 7: Procesar el objeto newUser, si se envía (crear o actualizar manager)
            if (newUser) {
                // Validar datos obligatorios del usuario
                if (!newUser.name || !newUser.email || !newUser.phone || !newUser.countryCode) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Faltan datos obligatorios en el ADMIN de la tienda.",
                    });
                }



                const password = "PanificadoraSiloe.2025";
                const defaultPassword = await bcrypt.hash(password, SALT_ROUNDS);

                if (newUser.id) {
                    // 📝 CASO 1: Actualizar usuario existente (futuro)
                    const existingUser = await users.findByPk(newUser.id, { transaction });
                    if (!existingUser) {
                        await transaction.rollback();
                        return res.status(404).json({
                            success: false,
                            status: 404,
                            message: "El ADMIN de la tienda no existe.",
                        });
                    }

                    // Actualizar datos del usuario existente
                    existingUser.first_name = newUser.name.split(' ')[0] || existingUser.first_name;
                    existingUser.last_name = newUser.name.split(' ')[1] || existingUser.last_name;
                    existingUser.email = newUser.email || existingUser.email;
                    existingUser.phone = `${newUser.countryCode}-${newUser.phone}` || existingUser.phone;
                    existingUser.status = newUser.status || existingUser.status;
                    await existingUser.save({ transaction });

                    // Asegurar que la tienda tenga este usuario como manager
                    store.manager_id = existingUser.id;

                } else {
                    // 🆕 CASO 2: Crear nuevo usuario manager (caso actual del frontend)
                    // 🔍 Buscar el rol STORE_MANAGER dinámicamente
                    const storeManagerRole = await roles.findOne({
                        where: { name: 'STORE_MANAGER' },
                        transaction
                    });

                    if (!storeManagerRole) {
                        await transaction.rollback();
                        return res.status(500).json({
                            success: false,
                            status: 500,
                            message: "No se pudo asignar el rol de manager de la tienda.",
                        });
                    }

                    // Verificar que el email no esté en uso
                    const existingUserByEmail = await users.findOne({
                        where: { email: newUser.email },
                        transaction
                    });

                    if (existingUserByEmail) {
                        await transaction.rollback();
                        return res.status(400).json({
                            success: false,
                            status: 400,
                            message: "El email del ADMIN ya está en uso.",
                        });
                    }

                    // Verificar que el teléfono no esté en uso
                    const phoneToCheck = `${newUser.countryCode}-${newUser.phone}`;
                    const existingUserByPhone = await users.findOne({
                        where: { phone: phoneToCheck },
                        transaction
                    });

                    if (existingUserByPhone) {
                        await transaction.rollback();
                        return res.status(400).json({
                            success: false,
                            status: 400,
                            message: "El teléfono del ADMIN ya está en uso.",
                        });
                    }

                    // Crear nuevo usuario manager
                    const createdManager = await users.create({
                        first_name: newUser.name.split(' ')[0] || 'Desconocido',
                        last_name: newUser.name.split(' ')[1] || 'Desconocido',
                        email: newUser.email,
                        phone: phoneToCheck,
                        role_id: storeManagerRole.id, // ✅ Asignar rol STORE_MANAGER
                        password: defaultPassword,
                        status: newUser.status || "inactive"
                    }, { transaction });

                    // ✅ Asignar el nuevo manager a la tienda
                    store.manager_id = createdManager.id;
                }
            }

            // Guardar los cambios de la tienda en la base de datos
            const newStoreRecord = await store.save({ transaction });

            // 🔸 PASO 9: Consultar la tienda actualizada con todas sus relaciones (igual que createStore)
            const updatedStore = await stores.findOne({
                where: { id: newStoreRecord.id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id', // Incluir company_id en la respuesta
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
                    'current_visit_status'
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    },
                ],
                transaction
            });

            // 🔸 PASO 10: Formatear respuesta para satisfacer la interfaz Store del frontend (igual que createStore)
            const storeData = updatedStore.toJSON();

            // Formatear manager si existe para satisfacer interfaz User
            if (storeData.manager) {
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (storeData.manager.phone) {
                    if (storeData.manager.phone.includes('-')) {
                        [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                    } else {
                        phoneNumber = storeData.manager.phone;
                    }
                }

                storeData.manager = {
                    id: storeData.manager.id,
                    name: storeData.manager.first_name,
                    lastName: storeData.manager.last_name,
                    email: storeData.manager.email,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    status: storeData.manager.status
                };
            }

            // Agregar array de imágenes vacío para satisfacer interfaz Store
            storeData.images = [];

            // 🔸 PASO 11: Confirmar transacción y devolver respuesta exitosa (misma estructura que createStore)
            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Tienda actualizada exitosamente",
                store: storeData // ✅ Cambiado de 'data' a 'store' para consistencia
            });
        } catch (error) {
            // 🚨 Rollback en caso de error
            await transaction.rollback();
            console.error("❌ Error al actualizar tienda:", error);

            // 🔍 Manejo específico de errores de restricción única (igual que createStore)
            if (error.name === 'SequelizeUniqueConstraintError') {
                if (error.original && error.original.constraint) {
                    switch (error.original.constraint) {
                        case 'users_email_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El email del ADMIN ya está registrado en el sistema.",
                            });
                        case 'users_phone_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El teléfono del ADMIN ya está registrado en el sistema.",
                            });
                        case 'idx_stores_company_address_unique':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "Ya existe una tienda registrada en esta dirección para su compañía.",
                            });
                        default:
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "Ya existe un registro con estos datos.",
                            });
                    }
                }
            }

            // 🔍 Manejo específico de errores de validación
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`,
                });
            }

            // Error genérico para otros casos
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al actualizar la tienda.",
            });
        }
    },

    // 📌 Método para obtener todas las tiendas que le pertenecen a una ruta
    async getStoresbyRoute(req, res) {
        const { route_id } = req.params;

        try {
            // 🔍 Validar que route_id esté presente
            if (!route_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ups! No se reconoce la ruta.",
                });
            }

            // 📊 Obtener todas las tiendas con TODAS las relaciones (igual que createStore/updateStore)
            const allStores = await stores.findAll({
                where: { route_id: route_id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id',
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
                    'current_visit_status',
                    'current_visit_id' // 🆕 Incluir visit_id persistente
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    },
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary']
                    }
                ]
            });

            // 🎨 Formatear respuesta para el frontend (igual que createStore/updateStore)
            const formattedStores = allStores.map(store => {
                const storeData = store.toJSON();

                // Formatear manager si existe para satisfacer interfaz User
                if (storeData.manager) {
                    let countryCode = undefined;
                    let phoneNumber = undefined;

                    if (storeData.manager.phone) {
                        if (storeData.manager.phone.includes('-')) {
                            [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                        } else {
                            phoneNumber = storeData.manager.phone;
                        }
                    }

                    storeData.manager = {
                        id: storeData.manager.id,
                        name: storeData.manager.first_name,
                        lastName: storeData.manager.last_name,
                        email: storeData.manager.email,
                        countryCode: countryCode,
                        phone: phoneNumber,
                        status: storeData.manager.status
                    };
                }

                // ✅ Asegurar que images sea un array (puede venir como null)
                if (!storeData.images) {
                    storeData.images = [];
                }

                return storeData;
            });

            // ✅ Devolver respuesta con estructura consistente
            return res.status(200).json({
                success: true,
                status: 200,
                message: `Se encontraron ${formattedStores.length} tiendas en la ruta`,
                stores: formattedStores
            });

        } catch (error) {
            console.error("❌ Error al obtener tiendas por ruta:", error);

            // 🔍 Manejo específico de errores de validación
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`,
                });
            }

            // Error genérico
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al obtener las tiendas.",
            });
        }
    },

    // 📌 Método para obtener la lista de tiendas huérfanas
    async getOrphanStores(req, res) {

        const { company_id } = req.params;

        if (!company_id) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Ups! No se reconoce la compañía.",
            });
        }

        try {
            // 📊 Obtener todas las tiendas huérfanas con TODAS las relaciones (igual que createStore/updateStore)
            const orphanStores = await stores.findAll({
                where: { route_id: null, company_id: company_id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id', // ✅ Incluir company_id 
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city', 'state',
                    'country',
                    'current_visit_status'
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    },
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary']
                    }
                ]
            });

            // 🎨 Formatear respuesta para el frontend (igual que createStore/updateStore)
            const formattedStores = orphanStores.map(store => {
                const storeData = store.toJSON();

                // Formatear manager si existe para satisfacer interfaz User
                if (storeData.manager) {
                    let countryCode = undefined;
                    let phoneNumber = undefined;

                    if (storeData.manager.phone) {
                        if (storeData.manager.phone.includes('-')) {
                            [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                        } else {
                            phoneNumber = storeData.manager.phone;
                        }
                    }

                    storeData.manager = {
                        id: storeData.manager.id,
                        name: storeData.manager.first_name,
                        lastName: storeData.manager.last_name,
                        email: storeData.manager.email,
                        countryCode: countryCode,
                        phone: phoneNumber,
                        status: storeData.manager.status
                    };
                }

                // ✅ Asegurar que images sea un array (puede venir como null)
                if (!storeData.images) {
                    storeData.images = [];
                }

                return storeData;
            });

            // ✅ Devolver respuesta con estructura consistente
            return res.status(200).json({
                success: true,
                status: 200,
                message: `Se encontraron ${formattedStores.length} tiendas huérfanas`,
                stores: formattedStores
            });

        } catch (error) {
            console.error("❌ Error al obtener tiendas huérfanas:", error);

            // 🔍 Manejo específico de errores de validación
            if (error.name === 'SequelizeValidationError') {
                const validationMessages = error.errors.map(err => err.message).join(', ');
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `Error de validación: ${validationMessages}`,
                });
            }

            // Error genérico
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al obtener las tiendas huérfanas.",
            });
        }
    },

    // 📌 Método para eliminar una tienda 
    async deleteStore(req, res) {

        try {
            const { id } = req.params;

            // Verificar si la tienda existe
            const store = await stores.findByPk(id);
            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La tienda que intenta eliminar YA NO EXISTE."
                });
            }

            // Eliminar la tienda
            await stores.destroy({ where: { id } });

            return res.status(200).json({
                success: true,
                status: 200,
                message: "La tienda ha sido eliminada exitosamente."
            });
        } catch (error) {
            console.error("❌ Error al eliminar tienda:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al eliminar la tienda."
            });
        }
    },

    // 📌 Método para asignar una tienda a una ruta
    async assignStoreToRoute(req, res) {

        const { storeId } = req.params;
        const { route_id } = req.body;

        try {
            // Verificar si la tienda existe
            const store = await stores.findByPk(storeId);
            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La tienda que intenta asignar YA NO EXISTE."
                });
            }

            // Asignar la tienda a la ruta
            store.route_id = route_id;
            await store.save();

            const createdStore = await stores.findOne({
                where: { id: storeId },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id', // ✅ Incluir company_id en la respuesta
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
                    'current_visit_status'
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    },
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary']
                    }
                ]
            });

            // 🎨 Formatear respuesta para el frontend
            const storeData = createdStore.toJSON();
            // ✅ Asegurar que images sea un array (puede venir como null)
            if (!storeData.images) {
                storeData.images = [];
            }

            // Formatear manager si existe
            if (storeData.manager) {
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (storeData.manager.phone) {
                    if (storeData.manager.phone.includes('-')) {
                        [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                    } else {
                        phoneNumber = storeData.manager.phone;
                    }
                }

                storeData.manager = {
                    id: storeData.manager.id,
                    name: storeData.manager.first_name,
                    lastName: storeData.manager.last_name,
                    email: storeData.manager.email,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    status: storeData.manager.status
                };
            }

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Asignacion exitosa.",
                store: storeData
            });

        } catch (error) {
            console.error("❌ Error al asignar tienda a ruta:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Ups! Algo paso asignando la tienda a la ruta."
            });
        }
    },

    // 📌 Método para actualizar una tienda como visitada
    async updateStoreAsVisited(req, res) {
        let transaction = null;
        try {
            const { store_id } = req.params;
            const { distance } = req.body;
            const user_id = req.user.id;

            // 🔍 VALIDACIONES (optimizadas y concisas)
            if (!store_id || !distance) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: !store_id ? 'No se identifica la tienda' : 'Distancia requerida'
                });
            }

            const parsedDistance = parseFloat(distance);
            if (isNaN(parsedDistance) || parsedDistance < 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Distancia debe ser número válido ≥ 0'
                });
            }

            // 📍 Distancia configurable por environment (más realista)
            const MAX_VISIT_DISTANCE = parseInt(process.env.MAX_VISIT_DISTANCE) || 300;
            if (parsedDistance > MAX_VISIT_DISTANCE) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Debes estar en la ubicación de la tienda para registrarla como visitada."
                });
            }

            // 🔍 Buscar tienda con datos completos (una sola consulta optimizada)
            const store = await stores.findByPk(parseInt(store_id), {
                include: [                 
                    { model: stores.sequelize.models.routes, as: 'route', attributes: ['name'] }
                ]
            });
            
            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Tienda no encontrada'
                });
            }

            // 🚫 Validar visita duplicada HOY (UTC correcto con Date.UTC explícito)
            const startOfTodayUTC = new Date(Date.UTC(
                new Date().getUTCFullYear(),
                new Date().getUTCMonth(),
                new Date().getUTCDate(),
                0, 0, 0, 0
            ));

            const endOfTodayUTC = new Date(Date.UTC(
                new Date().getUTCFullYear(),
                new Date().getUTCMonth(),
                new Date().getUTCDate(),
                23, 59, 59, 999
            ));

            const existingVisitToday = await store_visits.findOne({
                where: {
                    store_id: parseInt(store_id),
                    user_id: user_id,
                    date: {
                        [Op.between]: [startOfTodayUTC, endOfTodayUTC]
                    }
                }
            });

            if (existingVisitToday) {
                return res.status(409).json({
                    success: false,
                    status: 409,
                    message: 'Esta tienda ya fue visitada hoy',
                });
            }

            // Iniciar transacción
            transaction = await stores.sequelize.transaction();

            // 🔍 Obtener datos del usuario para desnormalización
            const currentUser = await users.findByPk(user_id, {
                attributes: ['first_name', 'last_name'],
                transaction
            });

            // ✅ CORRECTO: No envías 'date' - la BD usa DEFAULT CURRENT_TIMESTAMP
            // Usar directamente 'store' que ya tiene todos los datos necesarios
            const visitRecord = await store_visits.create({
                user_id,
                store_id: store.id,
                route_id: store.route_id,
                distance: parsedDistance,
                user_name: currentUser ? `${currentUser.first_name} ${currentUser.last_name}`.trim() : null,
                store_name: store.name, // ✅ Usar store directamente
                store_address: store.address, // ✅ Usar store directamente
                route_name: store.route ? store.route.name : null, // ✅ Usar store.route
                sale_amount: 0.00
            }, { transaction });

            // 🆕 Actualizar estado Y visit_id de la tienda (solución definitiva)
            store.current_visit_status = 'visited';
            store.current_visit_id = visitRecord.id;
            await store.save({ transaction });

            await transaction.commit();

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Tienda marcada como visitada exitosamente',
                store_visit_id: visitRecord.id               
            });

        } catch (error) {
            // ✅ ROLLBACK MEJORADO - verifica si la transacción ya finalizó
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }

            console.error('Error en updateStoreAsVisited:', error);
            
            res.status(500).json({
                success: false,
                message: 'Error interno del servidor al registrar visita',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    // 📌 Método para resetear todas las tiendas de una ruta a 'pending'
    async resetRouteVisits(req, res) {
        try {
            const { route_id } = req.params;

            if (!route_id || isNaN(parseInt(route_id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID de ruta inválido'
                });
            }

            // 🔄 Actualizar todas las tiendas de la ruta a 'pending' y limpiar visit_id
            const [updatedRows] = await stores.update(
                { 
                    current_visit_status: 'pending',
                    current_visit_id: null // 🆕 Limpiar visit_id para permitir nuevas visitas
                },
                {
                    where: { route_id: parseInt(route_id) },
                    returning: false
                }
            );



            res.status(200).json({
                success: true,
                message: `Se resetearon ${updatedRows} tiendas de la ruta ${route_id} a estado 'pending'`,
                data: {
                    route_id: parseInt(route_id),
                    stores_reset: updatedRows
                }
            });

        } catch (error) {
            console.error('❌ Error al resetear visitas de ruta:', error);
            res.status(500).json({
                success: false,
                message: 'Error interno del servidor al resetear las visitas',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

}