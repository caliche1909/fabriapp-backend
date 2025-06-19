const { stores, users, store_images, roles } = require('../models');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

module.exports = {

    // 📌 Método para obtener todas las tiendas que le pertenecen a una ruta
    async getStoresbyRoute(req, res) {

        const { route_id } = req.params;

        try {
            // Obtener todas las tiendas con sus relaciones completas (store_type y manager)
            const allStores = await stores.findAll({
                where: { route_id: route_id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
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
                        attributes: ['id', 'image_url', 'public_id', 'is_primary'],
                    }
                ]
            });

            // 🎨 Formatear respuesta para el frontend
            const formattedStores = allStores.map(store => {
                const storeData = store.toJSON();

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

                return storeData;
            });

            // Devolver todas las tiendas con sus relaciones
            return res.status(200).json(formattedStores);
        } catch (error) {
            console.error("❌ Error al obtener tiendas:", error);
            return res.status(500).json({ error: "Error al obtener tiendas." });
        }
    },

    // 📌 Método para crear una tienda con o sin usuario (TRANSACCIONAL)
    async createStore(req, res) {
        // 🔄 Iniciar transacción para garantizar atomicidad
        const transaction = await stores.sequelize.transaction();

        try {
            // 🔸 PASO 1: Extraer company_id de los parámetros y datos del request body
            const { company_id } = req.params;
            const { store, user } = req.body;
            console.log("USUARIO QUE LLEGA DEL FRONTEND", user);

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
                    'id', 'name', 'address', 'phone', 'neighborhood', 'route_id',
                    'company_id', // Incluir company_id en la respuesta
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time', 'closing_time',
                    'city', 'state', 'country'
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
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],
                        include: [{
                            association: 'role',
                            as: 'role',
                            attributes: ['id', 'name']
                        }]
                    },
                    {
                        association: 'company',
                        as: 'company',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'route',
                        as: 'route',
                        attributes: ['id', 'name'],
                        required: false // LEFT JOIN para que funcione si route_id es null
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
                    status: storeData.manager.status,
                    role: storeData.manager.role // Incluir rol completo
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
            console.error("❌ Error al crear tienda:", error);

            // 🔍 Manejo específico de errores de restricción única
            if (error.name === 'SequelizeUniqueConstraintError') {
                if (error.original && error.original.constraint) {
                    switch (error.original.constraint) {
                        case 'users_email_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El email del manager ya está registrado en el sistema.",
                            });
                        case 'users_phone_key':
                            return res.status(400).json({
                                success: false,
                                status: 400,
                                message: "El teléfono del manager ya está registrado en el sistema.",
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

            // Se espera que el body tenga dos propiedades: newStore y newUser


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
                store_type_id,
                manager_id
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
                        id: { [stores.sequelize.Op.ne]: id } // Excluir la tienda actual
                    },
                    transaction
                });

                if (existingStore) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Ya existe otra tienda registrada en esta dirección para su compañía.",
                    });
                }
            }

            // Transformar el nombre: eliminar espacios extra y convertir a mayúsculas
            let transformedName = name.trim().replace(/\s+/g, ' ').toUpperCase();

            // Actualizar los campos de la tienda (manteniendo los que no se envían)
            store.name = transformedName || store.name;
            store.address = address || store.address;
            store.phone = phone || store.phone;
            store.neighborhood = neighborhood;
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

            // Procesar el objeto newUser, si se envía
            if (newUser) {
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

                const password = "PanificadoraSiloe.2025";
                const defaultPassword = await bcrypt.hash(password, SALT_ROUNDS);

                if (store.manager_id) {
                    // Si la tienda ya tiene manager, buscarlo y actualizarlo
                    const existingManager = await users.findByPk(store.manager_id, { transaction });
                    if (existingManager) {
                        existingManager.first_name = newUser.first_name || newUser.name;
                        existingManager.last_name = newUser.last_name || newUser.lastName || '';
                        existingManager.email = newUser.email;
                        existingManager.phone = newUser.countryCode ? `${newUser.countryCode}-${newUser.phone}` : newUser.phone;
                        existingManager.status = newUser.status || 'inactive';

                        await existingManager.save({ transaction });
                    } else {
                        // En el caso poco frecuente que manager_id esté asignado pero no se encuentre el registro
                        const createdManager = await users.create({
                            first_name: newUser.first_name || newUser.name,
                            last_name: newUser.last_name || newUser.lastName || '',
                            email: newUser.email,
                            phone: `${newUser.countryCode}-${newUser.phone}`,
                            status: newUser.status || 'inactive',
                            role_id: storeManagerRole.id,
                            password: defaultPassword,
                        }, { transaction });
                        store.manager_id = createdManager.id;
                    }
                } else {
                    // Si no existe manager para la tienda, se crea uno nuevo
                    const createdManager = await users.create({
                        first_name: newUser.first_name || newUser.name,
                        last_name: newUser.last_name || newUser.lastName || '',
                        email: newUser.email,
                        phone: `${newUser.countryCode}-${newUser.phone}`,
                        status: newUser.status || 'inactive',
                        role_id: storeManagerRole.id,
                        password: defaultPassword,
                    }, { transaction });
                    store.manager_id = createdManager.id;
                }
            }

            // Guardar los cambios de la tienda en la base de datos
            const newStoreRecord = await store.save({ transaction });

            // Obtener la tienda actualizada con sus relaciones completas (store_type y manager)
            const updatedStore = await stores.findOne({
                where: { id: newStoreRecord.id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country'
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
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],
                        include: [{
                            association: 'role',
                            as: 'role',
                            attributes: ['id', 'name']
                        }]
                    }
                ],
                transaction
            });

            // 🎨 Formatear respuesta para el frontend
            const storeData = updatedStore.toJSON();

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
                    status: storeData.manager.status,
                    role: storeData.manager.role
                };
            }

            // Agregar array de imágenes vacío para satisfacer interfaz Store
            storeData.images = [];

            // Confirmar transacción
            await transaction.commit();

            console.log("✅ Tienda actualizada:", storeData);
            return res.status(200).json({
                success: true,
                status: 200,
                message: "Tienda actualizada exitosamente",
                data: storeData
            });
        } catch (error) {
            // Rollback en caso de error
            await transaction.rollback();
            console.error("❌ Error al actualizar tienda:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al actualizar la tienda."
            });
        }
    },

    // 📌 Método para obtener la lista de tiendas huerfanas
    async getOrphanStores(req, res) {
        console.log("📌 Intentando obtener todas las tiendas huérfanas...");

        try {
            // Obtener todas las tiendas huérfanas (sin ruta asociada)
            const orphanStores = await stores.findAll({
                where: { route_id: null },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country'
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
                        attributes: ['id', 'image_url', 'public_id', 'is_primary'],
                    }
                ]
            });

            // 🎨 Formatear respuesta para el frontend
            const formattedStores = orphanStores.map(store => {
                const storeData = store.toJSON();

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

                return storeData;
            });

            // Devolver la lista de tiendas huérfanas
            return res.status(200).json(formattedStores);
        } catch (error) {
            console.error("❌ Error al obtener tiendas huérfanas:", error);
            return res.status(500).json({ error: "Error al obtener tiendas huérfanas." });
        }
    },

    // 📌 Método para eliminar una tienda 
    async deleteStore(req, res) {
        console.log("📌 Intentando eliminar una tienda...");
        try {
            const { id } = req.params;

            // Verificar si la tienda existe
            const store = await stores.findByPk(id);
            if (!store) {
                return res.status(404).json({ error: "Tienda no encontrada." });
            }

            // Eliminar la tienda
            await stores.destroy({ where: { id } });

            return res.status(200).json({ message: "Tienda eliminada exitosamente." });
        } catch (error) {
            console.error("❌ Error al eliminar tienda:", error);
            return res.status(500).json({ error: "Error al eliminar tienda." });
        }
    },

    // 📌 Método para asignar una tienda a una ruta
    async assignStoreToRoute(req, res) {
        console.log("📌 Intentando asignar una tienda a una ruta...");
        const { storeId } = req.params;
        const { route_id } = req.body;

        try {
            // Verificar si la tienda existe
            const store = await stores.findByPk(storeId);
            if (!store) {
                return res.status(404).json({ error: "La tienda no existe" });
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
                    'image_url',
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
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
                ]
            });

            // 🎨 Formatear respuesta para el frontend
            const storeData = createdStore.toJSON();

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

            return res.status(200).json(storeData);

        } catch (error) {
            console.error("❌ Error al asignar tienda a ruta:", error);
            return res.status(500).json({ error: "Error al asignar tienda a ruta." });
        }
    }

}