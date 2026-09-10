const { stores, users, store_visits, roles } = require('../models');
const { autorizarSobreLaVisita } = require('../utils/storeVisits');
const {
    CODIGOS, leerCamposDeSincronizacion, buscarOperacionPrevia, esChoqueDeIdempotencia,
} = require('../utils/sincronizacion');
const { Op } = require('sequelize'); // ✅ Importar Op de Sequelize
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

/**
 * Cuántos días atrás puede estar la jornada que un marcado en diferido dice cerrar.
 *
 * Cubre de sobra el caso real —salir a las 5 a.m. y sincronizar al día siguiente, o un teléfono que
 * pasó la noche apagado— sin dejar que un `visit_id` viejo del cache del navegador reabra una
 * parada del histórico. Más allá de esto no se descarta el trabajo en silencio: se rechaza con un
 * mensaje que le dice al vendedor que hable con su supervisor.
 */
const MAX_DIAS_ATRAS_JORNADA = 2;

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
                // El vínculo tienda↔ruta se crea en routes_stores (M2M) tras crear la tienda.
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

            // 🔸 PASO 6: Verificar si existe tienda (activa o eliminada) en la misma dirección
            const existingStore = await stores.findOne({
                where: {
                    address: store.address,
                    company_id: company_id
                },
                paranoid: false, // 🔍 Incluir tiendas eliminadas
                transaction
            });

            // 🔄 Variables para el flujo unificado
            let finalStore = null;
            let isRestoration = false;

            if (existingStore) {
                if (existingStore.deleted_at) {
                    // 🔄 CASO 1: Tienda eliminada → RESTAURAR
                    console.log(`🔄 Restaurando tienda eliminada ID: ${existingStore.id}`);
                    isRestoration = true;

                    // Actualizar datos con la nueva información
                    await existingStore.update({
                        name: store.name,
                        phone: store.phone || existingStore.phone,
                        neighborhood: store.neighborhood,
                        store_type_id: store.store_type_id,
                        ubicacion: store.ubicacion || existingStore.ubicacion,
                        opening_time: store.opening_time || existingStore.opening_time,
                        closing_time: store.closing_time || existingStore.closing_time,
                        city: store.city || existingStore.city,
                        state: store.state || existingStore.state,
                        country: store.country || existingStore.country
                    }, { transaction });

                    // Restaurar (quita deleted_at y deleted_by)
                    await existingStore.restore({ transaction });
                    finalStore = existingStore;

                } else {
                    // 🚫 CASO 2: Tienda activa → ERROR
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Ya existe una tienda activa en esta dirección para su compañía.",
                    });
                }
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

                // Asignar el ID del nuevo usuario como manager
                if (isRestoration) {
                    // Si es restauración, actualizar el manager en la tienda existente
                    await finalStore.update({ manager_id: newUser.id }, { transaction });
                } else {
                    // Si es creación nueva, asignar al objeto store
                    store.manager_id = newUser.id;
                }
            }

            // 🔸 PASO 8: Crear tienda SOLO si no es restauración
            if (!isRestoration) {
                const newStore = await stores.create(store, { transaction });
                finalStore = newStore;
            }

            // 🔸 PASO 8.1: Si la tienda pertenece a una ruta, crear el vínculo en
            // routes_stores (modelo M2M). Idempotente por el UNIQUE (route_id, store_id).
            if (route_id) {
                await stores.sequelize.models.routes_stores.findOrCreate({
                    where: { route_id: route_id, store_id: finalStore.id },
                    defaults: { route_id: route_id, store_id: finalStore.id, company_id: company_id },
                    transaction
                });
            }

            // 🔸 PASO 9: Consultar la tienda final (creada o restaurada) con todas sus relaciones
            const createdStore = await stores.findOne({
                where: { id: finalStore.id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'company_id', // Incluir company_id en la respuesta
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

            // 🔸 PASO 11: Confirmar transacción y devolver respuesta apropiada
            await transaction.commit();

            return res.status(201).json({
                success: true,
                status: 201,
                message: isRestoration
                    ? "Tienda restaurada exitosamente"
                    : "Tienda creada exitosamente",
                store: storeData,
                restored: isRestoration // Información adicional para el frontend
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
        const companyId = req.user?.companyId; // 🔒 compañía activa del usuario autenticado


        // 🔄 Iniciar transacción para garantizar atomicidad
        const transaction = await stores.sequelize.transaction();

        try {
            // Verificar si la tienda existe y pertenece a la compañía del usuario (evita IDOR
            // multi-tenant: checkPermission valida el permiso, no la pertenencia del recurso).
            const store = await stores.findOne({ where: { id, company_id: companyId }, transaction });
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
            // route_id ya NO vive en stores (M2M en routes_stores); se ignora aquí.

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
                    'company_id', // Incluir company_id en la respuesta
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

            const companyId = req.user?.companyId;
            const rid = parseInt(route_id, 10);

            // Día hábil del negocio (zona horaria de la compañía, Capa B) para proyectar el
            // estado de visita del DÍA (no el estado histórico persistido en la tienda).
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ hoy }] = await stores.sequelize.query(
                `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
                { type: stores.sequelize.QueryTypes.SELECT, replacements: { tz } }
            );

            // Visitas de HOY de la JORNADA de esta ruta → mapa store_id -> visita más avanzada.
            //
            // La jornada se identifica por RUTA + DÍA, no por usuario: es la misma regla que ya
            // usa `getRouteDayVisits` ("una ruta tiene un solo responsable por día"). Antes esto
            // filtraba por `user_id: req.user.id`, y por eso un admin que abría la ruta de su
            // vendedor veía TODAS las tarjetas en 'pending' aunque la jornada fuera por la mitad.
            // El `visitRank` resuelve los datos antiguos que sí tienen dos responsables el mismo
            // día quedándose con la visita más avanzada.
            const todayVisits = await store_visits.findAll({
                where: { route_id: rid, visit_day: hoy },
                attributes: ['id', 'store_id', 'status'],
                raw: true,
            });

            // ¿La ruta tiene jornada hoy? Es lo que permite distinguir "la ruta no se ha
            // iniciado" de "la ruta está iniciada pero esta tienda no entró en la foto".
            const hayJornadaHoy = todayVisits.length > 0;
            const visitRank = { pending: 1, visited: 2, completed: 3 };
            const visitByStore = new Map();
            for (const v of todayVisits) {
                const cur = visitByStore.get(v.store_id);
                if (!cur || (visitRank[v.status] || 0) > (visitRank[cur.status] || 0)) {
                    visitByStore.set(v.store_id, v);
                }
            }

            // 📊 Tiendas MIEMBRO de la ruta (vía routes_stores), aisladas por compañía.
            // El estado de visita se PROYECTA desde la visita del día (store_visits);
            // ya no existe columna heredada en stores.
            const allStores = await stores.findAll({
                where: {
                    company_id: companyId,
                    [Op.and]: stores.sequelize.literal(
                        `EXISTS (SELECT 1 FROM routes_stores rs WHERE rs.store_id = "stores"."id" AND rs.route_id = ${rid})`
                    ),
                },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'company_id',
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

                // 🔄 Proyectar el estado de visita del DÍA. Son TRES casos, no dos:
                //   - hay parada           → su estado real ('pending' | 'visited' | 'completed').
                //   - hay jornada, sin parada → 'sin_parada': la tienda se vinculó a la ruta
                //     DESPUÉS de iniciarla, así que no se puede marcar (el servidor responde 409).
                //     Sin este caso la tarjeta se veía igual que una pendiente real e invitaba a
                //     marcar algo que iba a ser rechazado con un mensaje falso ("inicia la ruta",
                //     cuando ya está iniciada). Se resuelve con el botón "Ajustar".
                //   - no hay jornada       → 'pending': la ruta aún no se ha iniciado (ahí sí, el
                //     mensaje de "primero inicia la ruta" es correcto).
                const dayVisit = visitByStore.get(storeData.id);
                storeData.current_visit_status = dayVisit
                    ? dayVisit.status
                    : (hayJornadaHoy ? 'sin_parada' : 'pending');
                storeData.current_visit_id = dayVisit ? dayVisit.id : null;
                // Contexto de ruta: el frontend usa route_id como la ruta abierta.
                storeData.route_id = rid;

                return storeData;
            });

            // 📊 Resumen de la JORNADA de hoy, para el anillo de progreso de la ruta.
            //
            // Se calcula sobre `todayVisits`, que YA está en memoria (se cargó arriba para proyectar
            // `current_visit_status`): es un recorrido de un array de unas decenas de elementos,
            // sin una sola consulta extra ni una petición extra.
            //
            // ❗ Por qué hace falta: el anillo se calculaba sobre las TARJETAS, que son la membresía
            // de la ruta (`routes_stores`). Una parada **ocasional** no es miembro —a propósito, si no
            // la tienda quedaría en la ruta para siempre— así que era invisible: con 45 miembros y una
            // ocasional pendiente, el anillo decía "45/45, 100 %" con una parada sin hacer.
            //
            // `ocasionales` es el DELTA que el cliente no puede deducir por su cuenta: las tarjetas le
            // dan la parte de miembros (y viva, porque se parchea al marcar y vender), y esto le da lo
            // que le falta. `total`/`completadas` van también por si se quiere el conteo entero.
            const resumenJornada = {
                iniciada: hayJornadaHoy,
                total: todayVisits.length,
                completadas: 0,
                visitadas: 0,
                pendientes: 0,
                ocasionales: { total: 0, completadas: 0 },
            };
            const idsMiembros = new Set(formattedStores.map((s) => s.id));
            for (const v of todayVisits) {
                if (v.status === 'completed') resumenJornada.completadas += 1;
                else if (v.status === 'visited') resumenJornada.visitadas += 1;
                else resumenJornada.pendientes += 1;

                // Ocasional = parada del día cuya tienda NO está en la membresía de la ruta. Se
                // deduce así —y no por `visit_type`— porque lo que el cliente necesita es justo
                // "lo que no ves en las tarjetas", que incluye también la parada de una tienda
                // retirada de la ruta con la jornada ya abierta.
                if (!idsMiembros.has(v.store_id)) {
                    resumenJornada.ocasionales.total += 1;
                    if (v.status === 'completed') resumenJornada.ocasionales.completadas += 1;
                }
            }

            // ✅ Devolver respuesta con estructura consistente
            return res.status(200).json({
                success: true,
                status: 200,
                message: `Se encontraron ${formattedStores.length} tiendas en la ruta`,
                stores: formattedStores,
                jornada: resumenJornada
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
                where: {
                    company_id: company_id,
                    // Huérfana = SIN vínculos en routes_stores (ya no basta route_id NULL).
                    [Op.and]: stores.sequelize.literal(
                        `NOT EXISTS (SELECT 1 FROM routes_stores rs WHERE rs.store_id = "stores"."id")`
                    ),
                },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'company_id', // ✅ Incluir company_id
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city', 'state',
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

    // 📌 Método para obtener TODAS las tiendas de la compañía (con o sin ruta).
    // Usado por "Gestión de tiendas". Incluye las rutas a las que pertenece cada
    // tienda (member_routes, M2M) para poder mostrarlas.
    async getAllStores(req, res) {
        // 🔒 Compañía SIEMPRE desde la sesión (no del path) → cierra IDOR multi-tenant.
        const company_id = req.user.companyId;

        if (!company_id) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Ups! No se reconoce la compañía.",
            });
        }

        try {
            const allStores = await stores.findAll({
                where: { company_id: company_id },
                attributes: [
                    'id', 'name', 'address', 'phone', 'neighborhood', 'company_id',
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time', 'closing_time', 'city', 'state', 'country'
                ],
                include: [
                    { association: 'store_type', as: 'store_type', attributes: ['id', 'name'] },
                    { association: 'manager', as: 'manager', attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'] },
                    { association: 'images', as: 'images', attributes: ['id', 'image_url', 'public_id', 'is_primary'] },
                    // Rutas a las que pertenece la tienda (M2M).
                    { association: 'member_routes', as: 'member_routes', attributes: ['id', 'name'], through: { attributes: [] } },
                ],
                order: [['name', 'ASC']],
            });

            const formattedStores = allStores.map(store => {
                const storeData = store.toJSON();

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

                if (!storeData.images) {
                    storeData.images = [];
                }

                return storeData;
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: `Se encontraron ${formattedStores.length} tiendas`,
                stores: formattedStores
            });

        } catch (error) {
            console.error("❌ Error al obtener todas las tiendas:", error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al obtener las tiendas.",
            });
        }
    },

    // 📌 Método para eliminar una tienda
    async deleteStore(req, res) {
        // 🔄 Usar transacción para garantizar atomicidad entre deleted_by y destroy
        const transaction = await stores.sequelize.transaction();

        try {
            const { id } = req.params;
            const user_id = req.user?.id; // Usuario que hace la eliminación
            const companyId = req.user?.companyId; // 🔒 compañía activa del usuario autenticado

            // Verificar si la tienda existe y pertenece a la compañía del usuario (evita IDOR
            // multi-tenant). paranoid: true excluye ya eliminadas automáticamente.
            const store = await stores.findOne({ where: { id, company_id: companyId }, transaction });
            if (!store) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La tienda que intenta eliminar YA NO EXISTE."
                });
            }

            // Verificar que la tienda no tenga una visita EN CURSO hoy (visitada/vendida).
            // El estado de visita vive ahora en store_visits (no en la tienda).
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ hoy }] = await stores.sequelize.query(
                `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
                { type: stores.sequelize.QueryTypes.SELECT, replacements: { tz }, transaction }
            );
            const visitaEnCurso = await store_visits.findOne({
                where: { store_id: store.id, visit_day: hoy, status: ['visited', 'completed'] },
                transaction
            });
            if (visitaEnCurso) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "La tienda no puede ser eliminada porque tiene procesos activos"
                });
            }

            // 🗑️ Soft delete con auditoría automática via hook
            await store.destroy({
                userId: user_id, // Hook lo usará para deleted_by
                transaction
            });

            // 🎯 Confirmar transacción
            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: "La tienda ha sido eliminada exitosamente."
            });

        } catch (error) {
            // 🔄 Rollback en caso de error
            await transaction.rollback();
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
        const companyId = req.user?.companyId; // 🔒 compañía activa del usuario autenticado

        try {
            // Verificar que la tienda exista y sea de la compañía del usuario (evita IDOR multi-tenant)
            const store = await stores.findOne({ where: { id: storeId, company_id: companyId } });
            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La tienda que intenta asignar YA NO EXISTE."
                });
            }

            // El vínculo tienda↔ruta vive en routes_stores (M2M). Idempotente por el UNIQUE.
            if (route_id) {
                // 🔒 Validar que la ruta también pertenezca a la compañía del usuario (evita
                // mezclar una tienda con una ruta de otra compañía en routes_stores).
                const route = await stores.sequelize.models.routes.findOne({
                    where: { id: route_id, company_id: companyId }
                });
                if (!route) {
                    return res.status(404).json({
                        success: false,
                        status: 404,
                        message: "La ruta indicada no existe en su compañía."
                    });
                }

                await stores.sequelize.models.routes_stores.findOrCreate({
                    where: { route_id: route_id, store_id: store.id },
                    defaults: { route_id: route_id, store_id: store.id, company_id: companyId }
                });
            }

            const createdStore = await stores.findOne({
                where: { id: storeId },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'company_id', // ✅ Incluir company_id en la respuesta
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

    // 📌 Método para DESVINCULAR una tienda de UNA ruta (M2M). No borra la tienda,
    // solo elimina su vínculo en routes_stores con esa ruta.
    async removeStoreFromRoute(req, res) {
        try {
            const { storeId, routeId } = req.params;
            const companyId = req.user?.companyId;
            const sid = parseInt(storeId);
            const rid = parseInt(routeId);

            if (isNaN(sid) || isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'Identificadores inválidos.' });
            }

            const store = await stores.findByPk(sid);
            if (!store) {
                return res.status(404).json({ success: false, status: 404, message: 'La tienda ya no existe.' });
            }

            // Eliminar el vínculo M2M (aislado por compañía).
            const deleted = await stores.sequelize.models.routes_stores.destroy({
                where: { store_id: sid, route_id: rid, company_id: companyId }
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: deleted > 0 ? 'Tienda desvinculada de la ruta.' : 'La tienda no estaba vinculada a esa ruta.'
            });
        } catch (error) {
            console.error("❌ Error al desvincular tienda de ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno al desvincular la tienda.' });
        }
    },

    // 📌 Método para actualizar una tienda como visitada
    async updateStoreAsVisited(req, res) {
        let transaction = null;
        // Declarado fuera del try porque el `catch` lo necesita para resolver la carrera de
        // idempotencia (ver el final de la función).
        let sync = { ok: true, clientOperationId: null, occurredAt: null, syncedAt: null, visitDay: null };
        try {
            const { store_id } = req.params;
            const { distance } = req.body;
            const user_id = req.user.id;

            // 🔁 Contrato de sincronización (todo opcional; ver utils/sincronizacion.js).
            // Sin estos campos el endpoint se comporta EXACTAMENTE como siempre, que es lo que
            // permite desplegar este backend antes que el frontend que los manda.
            sync = leerCamposDeSincronizacion(req.body);
            if (!sync.ok) {
                return res.status(400).json({
                    success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS, message: sync.message,
                });
            }

            // 🔍 VALIDACIONES (optimizadas y concisas)
            if (!store_id || distance === undefined || distance === null) {
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

            // 🔍 Buscar la tienda, acotada a la compañía de la sesión (defensa en profundidad
            //    frente a IDOR; el boundary real es la visita acotada por user_id más abajo).
            const store = await stores.findOne({ where: { id: parseInt(store_id), company_id: req.user.companyId } });

            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Tienda no encontrada'
                });
            }

            // 🔁 IDEMPOTENCIA. ¿Ya procesamos esta misma operación? Pasa cuando el marcado llegó,
            // se guardó, y la RESPUESTA se perdió (mala cobertura, timeout del cliente): la cola
            // reintenta con el MISMO uuid. Se responde 200 con lo que ya existe en vez de un 409
            // que la cola tendría que interpretar.
            // Se comprueba después de validar la tienda para no filtrar nada de otra compañía, y
            // se exige que la operación previa sea de ESTA tienda: si no, el cliente reutilizó un
            // uuid para dos cosas distintas, y eso es un error suyo que hay que hacer visible.
            if (sync.clientOperationId) {
                const previa = await buscarOperacionPrevia(store_visits, sync.clientOperationId);
                if (previa) {
                    if (previa.store_id !== store.id) {
                        return res.status(409).json({
                            success: false, status: 409, code: CODIGOS.DATOS_INVALIDOS,
                            message: 'Ese identificador de operación ya se usó para otra tienda.',
                        });
                    }
                    return res.status(200).json({
                        success: true, status: 200, code: CODIGOS.YA_REGISTRADO,
                        message: 'Esta visita ya estaba registrada.',
                        store_visit_id: previa.id,
                    });
                }
            }

            // Identificación de la parada que se está cerrando, de más precisa a menos:
            //   1. `visit_id` — la parada exacta. Es como ya trabajan `createSale` y el reporte
            //      de no-venta, que la reciben y no adivinan nada.
            //   2. `route_id` — la ruta en cuyo contexto se marca (desambigua la M2M).
            // Se aceptan las dos por compatibilidad: el frontend y el backend se despliegan por
            // separado, y una pestaña abierta con el JS viejo solo manda `route_id`.
            const bodyVisitId = req.body.visit_id ? parseInt(req.body.visit_id) : null;
            const bodyRouteId = req.body.route_id ? parseInt(req.body.route_id) : null;

            // Día hábil del negocio (zona horaria de la compañía, Capa B).
            //
            // 🔴 Este `hoy` era el problema del trabajo offline: se calcula EN EL MOMENTO DE LA
            // PETICIÓN, así que sincronizar a las 00:30 —el vendedor volvió tarde y el teléfono se
            // enganchó al wifi de casa— rechazaba la jornada ENTERA, porque ninguna parada de ayer
            // coincide con el "hoy" de ahora.
            //
            // Solución: el cliente puede declarar a qué **día de negocio** pertenece el trabajo
            // (`visit_day`), capturado cuando lo hizo. No se acepta cualquier fecha: se acota a los
            // últimos días. Esa cota no es burocracia — protege lo que protegía el filtro original:
            // que un `visit_id` viejo, cacheado en el navegador, cierre una parada del histórico.
            // Es una ventana distinta de la de `occurred_at` a propósito: aquella acota la HORA que
            // se estampa; esta acota A QUÉ JORNADA se puede tocar, y esa tiene que ser más estricta.
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ hoy, dia_objetivo, dias_atras }] = await stores.sequelize.query(
                `SELECT to_char((now() AT TIME ZONE :tz)::date, 'YYYY-MM-DD') AS hoy,
                        to_char(COALESCE(CAST(:visitDay AS date), (now() AT TIME ZONE :tz)::date), 'YYYY-MM-DD') AS dia_objetivo,
                        ((now() AT TIME ZONE :tz)::date
                         - COALESCE(CAST(:visitDay AS date), (now() AT TIME ZONE :tz)::date)) AS dias_atras`,
                { type: stores.sequelize.QueryTypes.SELECT, replacements: { tz, visitDay: sync.visitDay } }
            );

            const atras = Number(dias_atras);
            if (atras < 0 || atras > MAX_DIAS_ATRAS_JORNADA) {
                return res.status(400).json({
                    success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS,
                    message: atras < 0
                        ? 'No se puede registrar una visita en una fecha futura.'
                        : `Esta visita es de hace ${atras} días y ya no se puede registrar. Repórtalo a tu supervisor.`,
                });
            }

            transaction = await stores.sequelize.transaction();

            // Buscar la parada del DÍA (visita) de esta tienda para HOY.
            //
            // 🔑 Ya NO se acota por `user_id`. La parada pertenece a la JORNADA (ruta + día);
            // quién puede tocarla lo decide el ENCARGADO ACTUAL de la ruta, no a nombre de quién
            // quedó la fila. Ese cambio es el que permite el relevo a media jornada: si el
            // vendedor se accidenta y se reasigna la ruta, el nuevo encargado continúa desde
            // donde quedó, incluso sobre paradas que el anterior ya dejó en 'visited'.
            // ⚠️ NO se crean visitas ad-hoc: si la tienda no tiene parada hoy se rechaza (la
            //    ruta debe iniciarse primero, o ajustarse con el botón "Ajustar").
            // 🔴 Una tienda puede estar en VARIAS rutas a la vez (la M2M es intencional), así que
            //    "la parada de esta tienda hoy" puede no ser una sola. Esto era un `findOne` sin
            //    orden: con dos jornadas abiertas cerraba UNA CUALQUIERA, posiblemente la de la
            //    otra ruta, y el fallo era mudo (la ruta recorrida quedaba pendiente y la otra
            //    visitada sin que nadie fuera). Ahora, o se recibe la parada exacta, o se exige
            //    que la búsqueda dé un único resultado.
            let visitRecord = null;

            // `dia_objetivo` es HOY salvo que el cliente declare la jornada a la que pertenece el
            // trabajo (marcado en diferido, ya acotado arriba). El resto de la lógica no cambia.
            const esDeHoy = dia_objetivo === hoy;

            if (bodyVisitId) {
                // Camino preciso. Se revalida contra tienda y día para que el id de otra tienda
                // —o de una jornada vieja que el navegador tenga en caché— no sirva de atajo.
                visitRecord = await store_visits.findOne({
                    where: { id: bodyVisitId, store_id: store.id, visit_day: dia_objetivo },
                    transaction,
                });

                if (!visitRecord) {
                    await transaction.rollback();
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        code: CODIGOS.VISITA_NO_EXISTE,
                        message: esDeHoy
                            ? 'La visita indicada no corresponde a esta tienda para hoy. Recarga la ruta e inténtalo de nuevo.'
                            : `La visita indicada no corresponde a esta tienda para el ${dia_objetivo}.`,
                    });
                }
            } else {
                const visitWhere = { store_id: store.id, visit_day: dia_objetivo };
                if (bodyRouteId) visitWhere.route_id = bodyRouteId;

                const candidatas = await store_visits.findAll({ where: visitWhere, transaction });

                if (candidatas.length > 1) {
                    await transaction.rollback();
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        code: CODIGOS.DATOS_INVALIDOS,
                        message: 'Esta tienda está programada hoy en varias rutas. Ábrela desde la ruta que estás recorriendo para poder marcarla.',
                    });
                }

                visitRecord = candidatas[0] || null;
            }

            if (!visitRecord) {
                await transaction.rollback();
                return res.status(409).json({
                    success: false,
                    status: 409,
                    code: CODIGOS.VISITA_NO_EXISTE,
                    message: esDeHoy
                        ? 'Esta tienda no tiene visitas pendientes para el día de hoy. Primero debes iniciar la ruta.'
                        : `Esta tienda no tenía una visita programada el ${dia_objetivo}.`,
                });
            }

            // 🔐 Solo el ENCARGADO ACTUAL de la ruta puede recorrerla (regla compartida).
            const permiso = await autorizarSobreLaVisita({
                visita: visitRecord, companyId: req.user.companyId, userId: user_id, transaction,
            });
            if (!permiso.autorizado) {
                await transaction.rollback();
                return res.status(403).json({
                    success: false, status: 403, code: CODIGOS.NO_ES_ENCARGADO, message: permiso.mensaje,
                });
            }

            if (visitRecord.status === 'visited' || visitRecord.status === 'completed') {
                await transaction.rollback();
                // Para la cola de reenvío esto NO es un fallo: la parada está cerrada, que es el
                // objetivo. `VISITA_YA_CERRADA` es su señal de "date por satisfecha y sigue".
                // Se distingue de `YA_REGISTRADO` a propósito: aquí la cerró OTRA operación (otro
                // vendedor tras un relevo, o un envío nuestro anterior sin uuid), así que la hora y
                // la distancia que traíamos NO son las que quedaron guardadas.
                return res.status(409).json({
                    success: false,
                    status: 409,
                    code: CODIGOS.VISITA_YA_CERRADA,
                    message: 'Esta tienda ya fue visitada hoy',
                });
            }

            // Avanzar la parada planificada 'pending' → 'visited', SELLANDO quién lo hizo.
            //
            // `user_id`/`user_name` pasan a significar "quién resolvió esta parada". Es lo que
            // hace que el histórico siga siendo verdadero tras un relevo: las paradas que hizo
            // el primer vendedor quedan a su nombre y las del segundo al suyo, sin columnas
            // nuevas. (La venta y el reporte de no-venta ya guardan su propio `user_id`.)
            const actor = await users.findByPk(user_id, { attributes: ['first_name', 'last_name'], transaction });

            visitRecord.status = 'visited';
            visitRecord.distance = parsedDistance;
            // 🕗 La hora de llegada es la que declara el cliente si la manda (ya acotada a una
            // ventana razonable). Sin esto, sincronizar en lote dejaría las 14 paradas del día a
            // la misma hora de la tarde y se perdería la traza real del recorrido.
            visitRecord.arrived_at = sync.occurredAt || new Date();
            visitRecord.client_operation_id = sync.clientOperationId;
            visitRecord.synced_at = sync.syncedAt;
            visitRecord.user_id = user_id;
            if (actor) visitRecord.user_name = `${actor.first_name} ${actor.last_name}`.trim();
            await visitRecord.save({ transaction });

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

            // 🔁 Carrera de dos peticiones idénticas simultáneas: el SELECT de idempedencia no vio
            // a la otra porque aún no había hecho commit, y el índice único frenó a la segunda.
            // La relectura va DESPUÉS del rollback y fuera de la transacción abortada: en Postgres,
            // una sentencia fallida invalida la transacción entera.
            if (esChoqueDeIdempotencia(error) && sync.clientOperationId) {
                const previa = await buscarOperacionPrevia(store_visits, sync.clientOperationId);
                if (previa) {
                    return res.status(200).json({
                        success: true, status: 200, code: CODIGOS.YA_REGISTRADO,
                        message: 'Esta visita ya estaba registrada.',
                        store_visit_id: previa.id,
                    });
                }
            }

            console.error('Error en updateStoreAsVisited:', error);

            res.status(500).json({
                success: false,
                message: 'Error interno del servidor al registrar visita',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

}