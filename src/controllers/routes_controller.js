const { routes, users, user_companies, roles } = require('../models');

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
    // 📌 Método para obtener todas las rutas de una compañía
    async getListRoutes(req, res) {
        console.log("📌 Intentando obtener todas las rutas de una compañía...", req.params);

        try {
            const { company_id } = req.params;

            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    routes: []
                });
            }

            // 🔹 Obtener rutas filtradas por company_id con información optimizada del vendedor
            const routesList = await routes.findAll({
                where: {
                    company_id: company_id
                },
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
                    message: "No hay rutas creadas para esta compañía aún",
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
                message: "Rutas obtenidas exitosamente",
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

    // 📌 Método para crear una nueva ruta
    async createRoute(req, res) {
        console.log("📌 Intentando crear una nueva ruta...", req.body);

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

            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "ID de compañía es requerido"
                });
            }

            // 🔹 Crear la nueva ruta
            const newRoute = await routes.create({
                name,
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

            console.log("✅ Ruta creada exitosamente:", formattedRoute);

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
        console.log("📌 Intentando actualizar una ruta...", req.body);

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
            route.name = name || route.name;
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

            console.log("✅ Ruta actualizada exitosamente:", formattedRoute);

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

    // 📌 Método para eliminar una ruta
    async deleteRoute(req, res) {
        console.log("📌 Intentando eliminar una ruta...");

        try {
            const { id } = req.params;

            // 🔹 Buscar la ruta
            const route = await routes.findByPk(id);
            if (!route) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta eliminar NO EXISTE!"
                });
            }

            await route.destroy();

            res.status(200).json({
                success: true,
                status: 200,
                message: "Ruta eliminada exitosamente."
            });
        } catch (error) {
            console.error("❌ Error al eliminar ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al eliminar la ruta"
            });
        }
    },


};

