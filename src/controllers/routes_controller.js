const { routes, users, user_companies, roles, stores, route_types, store_visits } = require('../models');
const { parseWindows, classify, formatMinutes, optimizeOpenStores } = require('../utils/routeOptimization');
const { Op } = require('sequelize');

// 🎯 Función helper para formatear datos del vendedor de forma consistente
const formatSellerData = (seller, assignment) => {
    if (!seller) return null;

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
        imageUrl: seller.image_url,
        imagePublicId: seller.image_public_id,
        userStatus: seller.status,
        role: assignment && assignment.role ? {
            id: assignment.role.id,
            name: assignment.role.name,
            label: assignment.role.label,
            description: assignment.role.description,
            isGlobal: assignment.role.is_global,
            isActive: assignment.role.is_active
        } : null,
        allowAccess: assignment ? assignment.status : null,
        userType: assignment ? assignment.user_type : null,
        requireGeolocation: seller.require_geolocation || false
    };
};

// 🎯 Función helper para obtener datos del vendedor con su rol
const getSellerWithRole = async (userId, companyId) => {
    if (!userId) return null;

    const sellerData = await users.findByPk(userId, {
        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status', 'image_url', 'image_public_id', 'require_geolocation'],
        include: [
            {
                model: user_companies,
                as: 'company_assignments',
                where: {
                    company_id: companyId,
                    status: 'active'
                },
                attributes: ['user_type', 'status'],
                include: [
                    {
                        model: roles,
                        as: 'role',
                        attributes: ['id', 'name', 'label', 'description', 'is_global', 'is_active']
                    }
                ],
                required: false
            }
        ],
        required: false
    });

    if (!sellerData) return null;

    const assignment = sellerData.company_assignments && sellerData.company_assignments.length > 0
        ? sellerData.company_assignments[0]
        : null;

    return formatSellerData(sellerData, assignment);
};

// 🎯 Validar que el vendedor asignado sea válido para la compañía (aislamiento multi-tenant).
// - Si no se envía vendedor (null/undefined) → válido (el vendedor es opcional).
// - Si se envía, debe:
//     (a) existir un vínculo ACTIVO en user_companies para esa compañía (membresía), y
//     (b) tener el usuario en estado global 'active' (users.status).
//   Si falla cualquiera, se rechaza (no confiar solo en el filtrado del cliente).
// Devuelve { valid: boolean, message?: string }.
const validateSellerInCompany = async (userId, companyId) => {
    if (!userId) return { valid: true };

    const membership = await user_companies.findOne({
        where: { user_id: userId, company_id: companyId, status: 'active' },
        attributes: ['id'],
        include: [{
            model: users,
            as: 'user',
            attributes: ['id', 'status']
        }]
    });

    if (!membership) {
        return {
            valid: false,
            message: "El vendedor seleccionado no pertenece a esta compañía o su vínculo está inactivo."
        };
    }

    if (membership.user && membership.user.status === 'inactive') {
        return {
            valid: false,
            message: "No puedes asignar un vendedor inactivo."
        };
    }

    return { valid: true };
};

module.exports = {

    // 📌 Método para obtener las rutas activas de una compañía
    // (paranoid: true automáticamente excluye rutas eliminadas)
    async getListRoutes(req, res) {

        try {
            const { company_id } = req.params;
            const { permission_type } = req.query;


            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    routes: []
                });
            }

            // 🔹 Validar permission_type
            if (!permission_type || !['all_routes', 'assigned_routes'].includes(permission_type)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Tipo de permiso inválido",
                    routes: []
                });
            }

            // 🔹 Preparar condiciones de filtro según el tipo de permiso
            let whereConditions = {
                company_id: company_id
            };

            // 🔹 Si el permiso es solo rutas asignadas, filtrar por usuario actual
            if (permission_type === 'assigned_routes') {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({
                        success: false,
                        status: 401,
                        message: "Usuario no autenticado",
                        routes: []
                    });
                }
                whereConditions.user_id = userId;
            }

            // 🔹 Obtener rutas filtradas con información optimizada del vendedor
            const routesList = await routes.findAll({
                where: whereConditions,
                attributes: ['id', 'name', 'working_days', 'user_id', 'route_type_id'],
                include: [
                    {
                        model: users,
                        as: 'seller',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status', 'image_url', 'image_public_id', 'require_geolocation'],
                        include: [
                            {
                                model: user_companies,
                                as: 'company_assignments',
                                where: {
                                    company_id: company_id,
                                    status: 'active'
                                },
                                attributes: ['user_type', 'status'],
                                include: [
                                    {
                                        model: roles,
                                        as: 'role',
                                        attributes: ['id', 'name', 'label', 'description', 'is_global', 'is_active']
                                    }
                                ],
                                required: false
                            }
                        ],
                        required: false
                    },
                    {
                        model: route_types,
                        as: 'route_type',
                        attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global'],
                        required: false
                    }
                ],
                order: [['created_at', 'DESC']]
            });

            // 🔹 Si no hay rutas, devolver lista vacía
            if (!routesList.length) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: permission_type === 'all_routes' ? "Su compañía aun no a creado rutas." : "No se encontraron rutas asignadas para este usuario",
                    routes: []
                });
            }

            // 📋 Formatear los datos de las rutas para el frontend
            const formattedRoutes = routesList.map(route => {
                const assignment = route.seller && route.seller.company_assignments && route.seller.company_assignments.length > 0
                    ? route.seller.company_assignments[0]
                    : null;

                return {
                    id: route.id,
                    name: route.name,
                    seller: route.seller ? formatSellerData(route.seller, assignment) : null,
                    working_days: route.working_days || [],
                    route_type_id: route.route_type_id || null,
                    route_type: route.route_type ? {
                        id: route.route_type.id,
                        name: route.route_type.name,
                        description: route.route_type.description,
                        color: route.route_type.color,
                        display_order: route.route_type.display_order,
                        is_active: route.route_type.is_active,
                        is_global: route.route_type.is_global
                    } : null
                    // ✅ NO incluimos stores según tu especificación
                };
            });


            res.status(200).json({
                success: true,
                status: 200,
                message: permission_type === 'all_routes' ? "Se han cargado todas las rutas de la compañía." : "Se han cargado las rutas asignadas a este usuario.",
                routes: formattedRoutes
            });

        } catch (error) {
            console.error("❌ Error al obtener rutas:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor",
                routes: []
            });
        }
    },

    // 📌 Método para eliminar una ruta (soft delete con auditoría)
    async deleteRoute(req, res) {
        // 🔄 Usar transacción para garantizar atomicidad entre deleted_by y destroy
        const transaction = await routes.sequelize.transaction();

        try {
            const { id } = req.params;
            const user_id = req.user?.id; // Usuario que hace la eliminación
            const companyId = req.user?.companyId; // 🔒 compañía del usuario autenticado (aislamiento multi-tenant)

            // 🔹 Verificar si la ruta existe (paranoid: true excluye ya eliminadas automáticamente)
            const route = await routes.findOne({ where: { id, company_id: companyId }, transaction });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta eliminar NO EXISTE o ya fue eliminada!"
                });
            }

            // 🔹 Verificar que la ruta no tenga tiendas vinculadas (validación de negocio).
            // El vínculo tienda↔ruta vive en routes_stores (M2M).
            const storesCount = await routes.sequelize.models.routes_stores.count({
                where: { route_id: id },
                transaction
            });

            if (storesCount > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `No se puede eliminar la ruta porque tiene ${storesCount} tienda(s) asignada(s). Primero debe reasignar las tiendas.`
                });
            }

            // 🗑️ Soft delete con auditoría automática via hook
            await route.destroy({
                userId: user_id, // El hook beforeDestroy usará este valor para deleted_by
                transaction
            });

            // 🎯 Confirmar transacción
            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: "La ruta ha sido eliminada exitosamente."
            });

        } catch (error) {
            // 🔄 Rollback en caso de error
            await transaction.rollback();
            console.error("❌ Error al eliminar ruta:", error);

            // 🔍 Manejo específico del error de auditoría (cuando no hay userId)
            if (error.message.includes('Se requiere un userId')) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Error de auditoría: Usuario no identificado para la eliminación."
                });
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al eliminar la ruta."
            });
        }
    },

    // 📌 Método para crear una nueva ruta
    async createRoute(req, res) {

        try {
            const { company_id } = req.params;
            const { name, user_id, working_days, route_type_id } = req.body;



            // 🔹 Validaciones básicas
            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
                });
            }

            // 🔹 Debe tener al menos un día hábil (si no, la ruta nunca podría iniciarse — D1)
            if (!Array.isArray(working_days) || working_days.length === 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Debe seleccionar al menos un día de trabajo para la ruta"
                });
            }

            // 🔹 Normalizar el nombre de la ruta
            const normalizedName = name.trim().replace(/\s+/g, ' ');

            // 🔹 Verificar si la compañía existe
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se identifico su compañía"
                });
            }

            // 🔹 Validar que el vendedor (si se envió) pertenezca a la compañía (multi-tenant)
            const sellerCheck = await validateSellerInCompany(user_id, company_id);
            if (!sellerCheck.valid) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: sellerCheck.message
                });
            }

            // 🔹 Verificar si ya existe una ruta con el mismo nombre en la compañía (activa o eliminada)
            const existingRoute = await routes.findOne({
                where: {
                    name: normalizedName,
                    company_id
                },
                paranoid: false // Incluir rutas eliminadas en la búsqueda                
            });

            if (existingRoute) {
                // 🔸 CASO 1: Ruta activa (deleted_at es null)
                if (existingRoute.deleted_at === null) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Ya existe una ruta con ese nombre. Por favor elija uno diferente."
                    });
                }

                // 🔸 CASO 2: Ruta eliminada (deleted_at tiene valor) - RESTAURAR
                // ⚠️ IMPORTANTE: Ignorar vendedor anterior de la ruta eliminada
                // Solo asignar el nuevo user_id si viene en los datos, sino dejarlo en null
                existingRoute.user_id = user_id || null;
                existingRoute.working_days = working_days || [];
                existingRoute.route_type_id = route_type_id || null;

                // Usar el hook beforeRestore para limpiar campos de auditoría
                await existingRoute.restore();

                // 🔹 Recargar la ruta con el route_type incluido
                await existingRoute.reload({
                    include: [{
                        model: route_types,
                        as: 'route_type',
                        attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                    }]
                });

                // 🔹 Obtener los datos del vendedor solo si se asignó uno nuevo
                const sellerData = existingRoute.user_id ? await getSellerWithRole(existingRoute.user_id, company_id) : null;

                // 🔹 Formatear respuesta para el frontend
                const formattedRoute = {
                    id: existingRoute.id,
                    name: existingRoute.name,
                    seller: sellerData,
                    working_days: existingRoute.working_days || [],
                    route_type_id: existingRoute.route_type_id || null,
                    route_type: existingRoute.route_type ? {
                        id: existingRoute.route_type.id,
                        name: existingRoute.route_type.name,
                        description: existingRoute.route_type.description,
                        color: existingRoute.route_type.color,
                        display_order: existingRoute.route_type.display_order,
                        is_active: existingRoute.route_type.is_active,
                        is_global: existingRoute.route_type.is_global
                    } : null,
                    stores: []
                };

                return res.status(201).json({
                    success: true,
                    status: 201,
                    message: "Ruta restaurada exitosamente",
                    route: formattedRoute,
                    restored: true // Indicador de que fue restaurada
                });
            }

            // 🔹 Crear la nueva ruta
            const newRoute = await routes.create({
                name: normalizedName,
                company_id,
                user_id: user_id || null,
                working_days: working_days || [],
                route_type_id: route_type_id || null
            });

            // 🔹 Recargar la ruta con el route_type incluido
            await newRoute.reload({
                include: [{
                    model: route_types,
                    as: 'route_type',
                    attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                }]
            });

            // 🔹 Obtener los datos del vendedor si existe
            const sellerData = await getSellerWithRole(user_id, company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: newRoute.id,
                name: newRoute.name,
                seller: sellerData,
                working_days: newRoute.working_days || [],
                route_type_id: newRoute.route_type_id || null,
                route_type: newRoute.route_type ? {
                    id: newRoute.route_type.id,
                    name: newRoute.route_type.name,
                    description: newRoute.route_type.description,
                    color: newRoute.route_type.color,
                    display_order: newRoute.route_type.display_order,
                    is_active: newRoute.route_type.is_active,
                    is_global: newRoute.route_type.is_global
                } : null,
                stores: []
            };

            res.status(201).json({
                success: true,
                status: 201,
                message: "Ruta creada exitosamente",
                route: formattedRoute
            });

        } catch (error) {
            console.error("❌ Error al crear ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // 📌 Método para actualizar una ruta
    async updateRoute(req, res) {

        try {
            const { id } = req.params;
            const { name, user_id, working_days, route_type_id } = req.body;
            const companyId = req.user?.companyId; // 🔒 compañía del usuario autenticado (aislamiento)

            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
                });
            }

            // 🔹 Si se envían días de trabajo, no pueden quedar vacíos (una ruta sin días
            //    hábiles nunca podría iniciarse — D1). Si no se envían, se conservan los actuales.
            if (working_days !== undefined && (!Array.isArray(working_days) || working_days.length === 0)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Debe seleccionar al menos un día de trabajo para la ruta"
                });
            }

            // 🔹 Normalizar el nombre de la ruta (consistente con createRoute)
            const normalizedName = name.trim().replace(/\s+/g, ' ');

            // 🔹 Buscar la ruta a actualizar, SCOPED a la compañía del usuario (evita IDOR
            //    multi-tenant: checkPermission valida el permiso, no la pertenencia del recurso).
            const route = await routes.findOne({ where: { id, company_id: companyId } });

            if (!route) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta actualizar NO EXISTE!"
                });
            }

            // 🔹 Verificar que el nuevo nombre no colisione con OTRA ruta activa de la compañía
            //    (consistente con createRoute; excluye la propia ruta por id).
            const duplicateRoute = await routes.findOne({
                where: {
                    name: normalizedName,
                    company_id: companyId,
                    id: { [Op.ne]: route.id }
                }
            });

            if (duplicateRoute) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ya existe una ruta con ese nombre. Por favor elija uno diferente."
                });
            }

            // 🔹 Validar que el vendedor (si se envió) pertenezca a la compañía de la ruta (multi-tenant)
            if (user_id) {
                const sellerCheck = await validateSellerInCompany(user_id, route.company_id);
                if (!sellerCheck.valid) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: sellerCheck.message
                    });
                }
            }

            // 🔹 Actualizar los campos
            route.name = normalizedName || route.name;
            route.user_id = user_id !== undefined ? user_id : route.user_id;
            route.working_days = working_days || route.working_days;
            route.route_type_id = route_type_id !== undefined ? route_type_id : route.route_type_id;

            await route.save();

            // 🔹 Recargar la ruta con el route_type incluido
            await route.reload({
                include: [{
                    model: route_types,
                    as: 'route_type',
                    attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                }]
            });

            // 🔹 Obtener los datos del vendedor actualizados si existe
            const sellerData = await getSellerWithRole(route.user_id, route.company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: route.id,
                name: route.name,
                seller: sellerData,
                working_days: route.working_days || [],
                route_type_id: route.route_type_id || null,
                route_type: route.route_type ? {
                    id: route.route_type.id,
                    name: route.route_type.name,
                    description: route.route_type.description,
                    color: route.route_type.color,
                    display_order: route.route_type.display_order,
                    is_active: route.route_type.is_active,
                    is_global: route.route_type.is_global
                } : null
                // ✅ NO incluimos stores
            };

            res.status(200).json({
                success: true,
                status: 200,
                message: "Ruta actualizada exitosamente",
                route: formattedRoute
            });

        } catch (error) {
            console.error("❌ Error al actualizar ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    /**
     * 🚀 INICIAR RUTA — Reemplaza a "reiniciar ruta".
     * Crea las visitas del DÍA (estado 'pending') para todas las tiendas de la ruta
     * (vía routes_stores). Idempotente: el UNIQUE (store_id, route_id, user_id,
     * visit_day) evita duplicados, así que iniciar dos veces no reinicia el progreso.
     *
     * Reglas (D1): solo el vendedor asignado (routes.user_id) puede iniciarla y solo
     * en un día hábil (working_days). Un OWNER puede iniciarla sin esas restricciones.
     */
    async startRoute(req, res) {
        const transaction = await routes.sequelize.transaction();
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const isOwner = req.user?.userType === 'owner';
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            // Ruta de la compañía del usuario.
            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, transaction });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // 🔐 ¿Quién resuelve estas visitas? Se crean a nombre de `effectiveUserId`.
            // Regla de negocio:
            //   - El que inicia para OTRO usuario debe ser owner o tener el permiso
            //     `start_route_for_others` (el frontend manda `target_user_id`).
            //   - Iniciar para uno mismo sin ese privilegio exige ser el vendedor
            //     asignado a la ruta y estar en un día hábil.
            const canStartForOthers = isOwner || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('start_route_for_others'));
            const targetUserId = req.body?.target_user_id ? String(req.body.target_user_id) : null;
            const startingForOther = targetUserId && targetUserId !== req.user.id;

            let effectiveUserId;
            if (startingForOther) {
                if (!canStartForOthers) {
                    await transaction.rollback();
                    return res.status(403).json({ success: false, status: 403, message: 'No tiene permiso para iniciar rutas a nombre de otro usuario.' });
                }
                // El destino debe ser un miembro ACTIVO de la compañía.
                const member = await user_companies.findOne({
                    where: { user_id: targetUserId, company_id: companyId, status: 'active' },
                    transaction,
                });
                if (!member) {
                    await transaction.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'El usuario seleccionado no pertenece a la empresa o no está activo.' });
                }
                effectiveUserId = targetUserId;
            } else {
                effectiveUserId = req.user.id;
            }

            // Día hábil + fecha del negocio (TZ America/Bogota).
            const [{ hoy, weekday }] = await routes.sequelize.query(
                `SELECT (now() AT TIME ZONE 'America/Bogota')::date AS hoy,
                        CASE trim(to_char(now() AT TIME ZONE 'America/Bogota','ID'))
                            WHEN '1' THEN 'lunes' WHEN '2' THEN 'martes' WHEN '3' THEN 'miercoles'
                            WHEN '4' THEN 'jueves' WHEN '5' THEN 'viernes' WHEN '6' THEN 'sabado'
                            WHEN '7' THEN 'domingo' END AS weekday`,
                { type: routes.sequelize.QueryTypes.SELECT, transaction }
            );

            // 🔁 Idempotencia explícita: si ESTE usuario ya tiene visitas para esta ruta hoy,
            // se devuelve lo que ya existe y NO se crea una segunda lista de pendientes.
            // Aplica igual si inicia para sí mismo o si un privilegiado inicia para otro:
            // (ruta + usuario efectivo + día) ya presente ⇒ no se duplica.
            const yaIniciada = await store_visits.count({
                where: { route_id: rid, user_id: effectiveUserId, visit_day: hoy },
                transaction,
            });
            if (yaIniciada > 0) {
                const tiendasEnRuta = await routes.sequelize.models.routes_stores.count({
                    where: { route_id: rid, company_id: companyId },
                    transaction,
                });
                await transaction.commit();
                return res.status(200).json({
                    success: true,
                    status: 200,
                    already_started: true,
                    message: 'Esta ruta ya estaba iniciada hoy para este usuario. Se devuelven las visitas existentes.',
                    route_id: rid,
                    visit_day: hoy,
                    tiendas_en_ruta: tiendasEnRuta,
                    visitas_del_dia: yaIniciada,
                });
            }

            // 🚫 Un responsable por día: si la ruta ya fue iniciada hoy por OTRO usuario,
            // no se permite crear una segunda lista (evita dos vendedores sobre las mismas
            // tiendas). Para otro comportamiento, se debe crear una ruta aparte.
            const otraLista = await store_visits.findOne({
                where: { route_id: rid, visit_day: hoy, user_id: { [Op.ne]: effectiveUserId } },
                attributes: ['user_id', 'user_name'],
                transaction,
            });
            if (otraLista) {
                await transaction.rollback();
                const quien = otraLista.user_name || 'otro usuario';
                return res.status(409).json({
                    success: false,
                    status: 409,
                    message: `Esta ruta ya fue iniciada hoy por ${quien}. Una ruta solo puede tener un responsable por día; si necesitas otro comportamiento, crea una ruta aparte.`,
                });
            }

            // Ruta propia sin privilegio: exige ser el vendedor asignado y día hábil.
            // Los privilegiados (owner o con permiso) se saltan ambas reglas.
            if (!canStartForOthers) {
                if (!route.user_id || route.user_id !== req.user.id) {
                    await transaction.rollback();
                    return res.status(403).json({ success: false, status: 403, message: 'Solo el vendedor asignado puede iniciar esta ruta.' });
                }
                const workingDays = route.working_days || [];
                if (!workingDays.includes(weekday)) {
                    await transaction.rollback();
                    return res.status(400).json({ success: false, status: 400, message: `Hoy (${weekday}) no es un día hábil de esta ruta.` });
                }
            }

            // Tiendas de la ruta (vía routes_stores) con datos para el snapshot.
            const memberStores = await stores.findAll({
                attributes: ['id', 'name', 'address'],
                include: [{
                    association: 'member_routes',
                    attributes: [],
                    through: { attributes: [] },
                    where: { id: rid },
                    required: true,
                }],
                transaction,
            });

            if (memberStores.length === 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La ruta no tiene tiendas para visitar.' });
            }

            // Nombre del usuario que resolverá las visitas, para desnormalizar en la parada.
            const solver = await users.findByPk(effectiveUserId, { attributes: ['first_name', 'last_name'], transaction });
            const solverName = solver ? `${solver.first_name} ${solver.last_name}`.trim() : null;

            // Crear las paradas del día en 'pending'. ignoreDuplicates → ON CONFLICT
            // DO NOTHING contra el UNIQUE diario (idempotente, no reinicia progreso).
            const rows = memberStores.map((s) => ({
                user_id: effectiveUserId,
                store_id: s.id,
                route_id: rid,
                visit_day: hoy,
                status: 'pending',
                distance: null,
                arrived_at: null,
                user_name: solverName,
                store_name: s.name,
                store_address: s.address,
                route_name: route.name,
                sale_amount: 0.00,
                date: new Date(),
            }));
            await store_visits.bulkCreate(rows, { ignoreDuplicates: true, transaction });

            // Conteo real del día tras la creación idempotente.
            const totalDia = await store_visits.count({ where: { route_id: rid, user_id: effectiveUserId, visit_day: hoy }, transaction });

            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Ruta iniciada. Se generaron las visitas del día.',
                route_id: rid,
                visit_day: hoy,
                tiendas_en_ruta: memberStores.length,
                visitas_del_dia: totalDia,
            });
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback();
            console.error("❌ Error al iniciar ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al iniciar la ruta.' });
        }
    },

    /**
     * 📋 GET /api/routes/:route_id/visits/today
     * Visitas del DÍA de una ruta (fuente del drawer de "Iniciar ruta").
     * Devuelve cuántas tiendas tiene la ruta, si ya se inició (hay visitas hoy),
     * el resumen por estado y la lista de visitas (con las paradas pendientes).
     */
    async getRouteDayVisits(req, res) {
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, attributes: ['id', 'name'] });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // Fecha objetivo: por defecto HOY (día hábil del negocio, TZ America/Bogota).
            // El calendario puede pedir otra fecha vía ?date=YYYY-MM-DD (el pasado es solo lectura).
            const [{ hoy, nowmin }] = await routes.sequelize.query(
                `SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS hoy,
                        EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Bogota')) * 60
                        + EXTRACT(MINUTE FROM (now() AT TIME ZONE 'America/Bogota')) AS nowmin`,
                { type: routes.sequelize.QueryTypes.SELECT }
            );
            const nowMin = Number(nowmin);
            let targetDate = hoy;
            if (req.query.date) {
                const d = String(req.query.date);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                    return res.status(400).json({ success: false, status: 400, message: 'Fecha inválida (formato esperado YYYY-MM-DD).' });
                }
                targetDate = d;
            }
            const isToday = targetDate === hoy;

            // Nº de tiendas de la ruta (vía routes_stores).
            const tiendasEnRuta = await routes.sequelize.models.routes_stores.count({ where: { route_id: rid, company_id: companyId } });

            // Visitas de la fecha (paradas) DEL USUARIO que consulta: pendientes primero,
            // luego por nombre. Cada quien ve solo la lista que él mismo inició (aislamiento
            // por user_id; ni siquiera el owner ve la lista de otro por aquí).
            // Se une la tienda para traer sus horarios y clasificar cada parada PENDIENTE por
            // horario (abierta/abre_mas_tarde/cerrada) según la hora actual. Esto NO depende del
            // GPS (solo el ORDEN óptimo lo hace, y ese ya está en optimized_seq), así los chips
            // de horario aparecen SIEMPRE que sea hoy: al abrir y al reabrir el drawer.
            const visitas = await store_visits.findAll({
                where: { route_id: rid, visit_day: targetDate, user_id: req.user.id },
                attributes: ['id', 'store_id', 'store_name', 'store_address', 'status', 'arrived_at', 'sale_amount', 'optimized_seq'],
                include: [{ association: 'store', attributes: ['opening_time', 'closing_time'], required: false }],
                order: [
                    // Pendientes primero; dentro de ellas, por el orden optimizado (NULLS LAST =
                    // las aún no optimizadas al final, alfabéticas). Visitadas/completadas por nombre.
                    [routes.sequelize.literal(`CASE store_visits.status WHEN 'pending' THEN 0 WHEN 'visited' THEN 1 ELSE 2 END`), 'ASC'],
                    routes.sequelize.literal('store_visits.optimized_seq ASC NULLS LAST'),
                    ['store_name', 'ASC'],
                ],
                raw: true,
            });

            const resumen = { pending: 0, visited: 0, completed: 0, total: visitas.length };
            for (const v of visitas) { if (resumen[v.status] !== undefined) resumen[v.status] += 1; }

            return res.status(200).json({
                success: true,
                status: 200,
                route_id: rid,
                route_name: route.name,
                visit_day: targetDate,
                today: hoy,
                is_today: isToday,
                tiendas_en_ruta: tiendasEnRuta,
                started: visitas.length > 0,
                resumen,
                visitas: visitas.map((v) => {
                    // Estado por horario solo para pendientes de HOY (es time-dependent).
                    let estado = null;
                    let abre_a = null;
                    if (isToday && v.status === 'pending') {
                        const c = classify(parseWindows(v['store.opening_time'], v['store.closing_time']), nowMin);
                        estado = c.estado;
                        if (c.estado === 'abre_mas_tarde') abre_a = formatMinutes(c.abreA);
                    }
                    return {
                        visit_id: v.id,
                        store_id: v.store_id,
                        store_name: v.store_name,
                        store_address: v.store_address,
                        status: v.status,
                        arrived_at: v.arrived_at,
                        sale_amount: Number(v.sale_amount) || 0,
                        optimized_seq: v.optimized_seq,
                        estado,
                        abre_a,
                    };
                }),
            });
        } catch (error) {
            console.error("❌ Error al obtener las visitas del día:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al obtener las visitas.' });
        }
    },

    /**
     * 🧭 GET /api/routes/:route_id/optimize?lat=&lng=
     * Recorrido óptimo del día para el vendedor. Sobre las visitas PENDIENTES de hoy:
     * clasifica cada tienda por horario (abierta / abre más tarde / cerrada) y ordena
     * las ABIERTAS desde el GPS del dispositivo (vecino más cercano + 2-opt, línea recta).
     * NO modifica datos: es una capa de orden/estado sobre las pendientes.
     */
    async optimizeRoute(req, res) {
        try {
            const { route_id } = req.params;
            const { lat, lng } = req.query;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }
            const latN = parseFloat(lat);
            const lngN = parseFloat(lng);
            if (isNaN(latN) || isNaN(lngN)) {
                return res.status(400).json({ success: false, status: 400, message: 'Se requiere tu ubicación (lat, lng).' });
            }

            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, attributes: ['id', 'name'] });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // Día hábil + minutos del momento actual (TZ America/Bogota).
            const [{ hoy, nowmin }] = await routes.sequelize.query(
                `SELECT (now() AT TIME ZONE 'America/Bogota')::date AS hoy,
                        EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Bogota')) * 60
                        + EXTRACT(MINUTE FROM (now() AT TIME ZONE 'America/Bogota')) AS nowmin`,
                { type: routes.sequelize.QueryTypes.SELECT }
            );
            const nowMin = Number(nowmin);

            // Visitas PENDIENTES del día DEL USUARIO que optimiza + coords/horarios.
            // Acotado por user_id: cada quien optimiza solo su propia lista.
            const pend = await routes.sequelize.query(
                `SELECT sv.id AS visit_id, sv.store_id, sv.store_name, sv.store_address,
                        ST_Y(s.ubicacion) AS lat, ST_X(s.ubicacion) AS lng,
                        s.opening_time, s.closing_time
                 FROM store_visits sv
                 JOIN stores s ON s.id = sv.store_id
                 WHERE sv.route_id = :rid AND sv.visit_day = :hoy AND sv.status = 'pending'
                   AND sv.user_id = :uid`,
                { replacements: { rid, hoy, uid: req.user.id }, type: routes.sequelize.QueryTypes.SELECT }
            );

            // Clasificar por horario.
            const abiertas = [];
            const abren_mas_tarde = [];
            const cerradas = [];
            for (const p of pend) {
                const base = {
                    visit_id: p.visit_id,
                    store_id: p.store_id,
                    store_name: p.store_name,
                    store_address: p.store_address,
                    lat: p.lat != null ? Number(p.lat) : null,
                    lng: p.lng != null ? Number(p.lng) : null,
                };
                const { estado, abreA } = classify(parseWindows(p.opening_time, p.closing_time), nowMin);
                if (estado === 'abierta') abiertas.push(base);
                else if (estado === 'abre_mas_tarde') abren_mas_tarde.push({ ...base, abre_a: formatMinutes(abreA) });
                else cerradas.push(base);
            }

            // Optimizar solo las abiertas desde el GPS.
            const origin = { lat: latN, lng: lngN };
            const { recorrido, distancia_total_m } = optimizeOpenStores(origin, abiertas);
            const recorridoConEstado = recorrido.map((r) => ({ ...r, estado: 'abierta' }));

            abren_mas_tarde.sort((a, b) => (a.abre_a || '').localeCompare(b.abre_a || ''));

            // 💾 Persistir el orden en `optimized_seq`: numeración CONTINUA de las pendientes
            // (abiertas optimizadas → abren más tarde → cerradas). Las no-pendientes se dejan en
            // NULL. Así, al reabrir el drawer, las pendientes cargan en este mismo orden.
            const orderedVisitIds = [
                ...recorridoConEstado.map((r) => r.visit_id),
                ...abren_mas_tarde.map((s) => s.visit_id),
                ...cerradas.map((s) => s.visit_id),
            ];
            const tx = await routes.sequelize.transaction();
            try {
                // Limpiar orden de las que ya no son pendientes (visitadas/completadas).
                await store_visits.update(
                    { optimized_seq: null },
                    { where: { route_id: rid, visit_day: hoy, user_id: req.user.id, status: { [Op.ne]: 'pending' } }, transaction: tx }
                );
                // Numerar las pendientes en el orden calculado.
                let seq = 1;
                for (const vid of orderedVisitIds) {
                    await store_visits.update({ optimized_seq: seq }, { where: { id: vid }, transaction: tx });
                    seq += 1;
                }
                await tx.commit();
            } catch (e) {
                await tx.rollback();
                throw e;
            }

            return res.status(200).json({
                success: true,
                status: 200,
                route_id: rid,
                route_name: route.name,
                visit_day: hoy,
                origin,
                recorrido: recorridoConEstado,
                abren_mas_tarde,
                cerradas,
                distancia_total_m,
                resumen: {
                    abiertas: recorridoConEstado.length,
                    abren_mas_tarde: abren_mas_tarde.length,
                    cerradas: cerradas.length,
                    total: pend.length,
                },
            });
        } catch (error) {
            console.error("❌ Error al optimizar la ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al optimizar la ruta.' });
        }
    },
};

