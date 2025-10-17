const { routes, users, user_companies, roles, stores } = require('../models');

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
                attributes: ['id', 'name', 'working_days', 'user_id'],
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
                    working_days: route.working_days || []
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

            // 🔹 Verificar si la ruta existe (paranoid: true excluye ya eliminadas automáticamente)
            const route = await routes.findByPk(id, { transaction });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta eliminar NO EXISTE o ya fue eliminada!"
                });
            }

            // 🔹 Verificar que la ruta no tenga tiendas asignadas (validación de negocio)
            const storesCount = await stores.count({
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
            const { name, user_id, working_days } = req.body;



            // 🔹 Validaciones básicas
            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
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

                // Usar el hook beforeRestore para limpiar campos de auditoría
                await existingRoute.restore();

                // 🔹 Obtener los datos del vendedor solo si se asignó uno nuevo
                const sellerData = existingRoute.user_id ? await getSellerWithRole(existingRoute.user_id, company_id) : null;

                // 🔹 Formatear respuesta para el frontend
                const formattedRoute = {
                    id: existingRoute.id,
                    name: existingRoute.name,
                    seller: sellerData,
                    working_days: existingRoute.working_days || [],
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
                working_days: working_days || []
            });

            // 🔹 Obtener los datos del vendedor si existe
            const sellerData = await getSellerWithRole(user_id, company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: newRoute.id,
                name: newRoute.name,
                seller: sellerData,
                working_days: newRoute.working_days || [],
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
            const { name, user_id, working_days } = req.body;

            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
                });
            }

            // 🔹 Normalizar el nombre de la ruta (consistente con createRoute)
            const normalizedName = name.trim().replace(/\s+/g, ' ');

            // 🔹 Buscar la ruta a actualizar
            const route = await routes.findByPk(id);

            if (!route) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta actualizar NO EXISTE!"
                });
            }

            // 🔹 Actualizar los campos
            route.name = normalizedName || route.name;
            route.user_id = user_id !== undefined ? user_id : route.user_id;
            route.working_days = working_days || route.working_days;

            await route.save();

            // 🔹 Obtener los datos del vendedor actualizados si existe
            const sellerData = await getSellerWithRole(route.user_id, route.company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: route.id,
                name: route.name,
                seller: sellerData,
                working_days: route.working_days || []
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
};

