const { routes, users, stores, store_types, roles } = require('../models');

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

            // 🔹 Obtener rutas filtradas por company_id
            const routesList = await routes.findAll({
                where: {
                    company_id: company_id // 🎯 FILTRO POR COMPAÑÍA
                },
                attributes: ['id', 'name', 'working_days'],
                include: [
                    {
                        model: users,
                        as: 'seller',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],
                        include: [
                            {
                                model: roles,
                                as: 'role',
                                attributes: ['id', 'name'],
                            },
                        ],
                    },
                ],
                order: [['created_at', 'DESC']] // Ordenar por fecha de creación
            });

            // 🔹 Formatear respuesta según la interfaz TypeScript
            const formattedRoutes = routesList.map(route => ({
                id: route.id,
                name: route.name,
                working_days: route.working_days, // Array de DayOfWeek
                seller: route.seller ? {
                    id: route.seller.id,
                    email: route.seller.email,
                    name: route.seller.first_name,
                    lastName: route.seller.last_name,
                    contryCode: route.seller.phone.split('-')[0],
                    phone: route.seller.phone.split('-')[1],
                    status: route.seller.status,
                    role: route.seller.role ? {
                        id: route.seller.role.id,
                        name: route.seller.role.name
                    } : null
                } : null,
                stores: []
            }));

            res.status(200).json({
                success: true,
                message: "Rutas obtenidas exitosamente",
                routes: formattedRoutes
            });

        } catch (error) {
            console.error("❌ Error al obtener rutas:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al obtener rutas de la compañía",
                routes: []
            });
        }
    },

    // 📌 Método para crear una ruta
    async createRoute(req, res) {


        try {
            const { name, user_id, working_days } = req.body;
            const { company_id } = req.params;

            // 🔹 Validaciones
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
                    message: "No se reconoce a la compañía"
                });
            }

            // 🔹 Verificar si la ruta ya existe en la misma compañía
            const routeExists = await routes.findOne({
                where: {
                    name,
                    company_id
                }
            });

            if (routeExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "La ruta que intenta crear YA EXISTE!"
                });
            }

            // 🔹 Crear la nueva ruta
            const newRoute = await routes.create({
                name,
                company_id,
                user_id: user_id || null,
                working_days: working_days || null
            });

            // 🔹 Si se asignó un vendedor, obtener sus datos completos
            let sellerData = null;
            if (user_id) {
                const routeWithSeller = await routes.findByPk(newRoute.id, {
                    include: [
                        {
                            model: users,
                            as: 'seller',
                            attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],
                            include: [
                                {
                                    model: roles,
                                    as: 'role',
                                    attributes: ['id', 'name']
                                }
                            ]
                        }
                    ]
                });

                if (routeWithSeller && routeWithSeller.seller) {
                    // Procesar el teléfono para separar código de país y número
                    let countryCode = undefined;
                    let phoneNumber = undefined;

                    if (routeWithSeller.seller.phone) {
                        if (routeWithSeller.seller.phone.includes('-')) {
                            [countryCode, phoneNumber] = routeWithSeller.seller.phone.split('-');
                        } else {
                            phoneNumber = routeWithSeller.seller.phone;
                        }
                    }

                    sellerData = {
                        id: routeWithSeller.seller.id,
                        email: routeWithSeller.seller.email,
                        name: routeWithSeller.seller.first_name,
                        lastName: routeWithSeller.seller.last_name,
                        countryCode: countryCode,
                        phone: phoneNumber,
                        status: routeWithSeller.seller.status,
                        role: {
                            id: routeWithSeller.seller.role.id,
                            name: routeWithSeller.seller.role.name
                        }
                    };
                }
            }

            console.log("✅ Ruta creada:", newRoute);

            res.status(201).json({
                success: true,
                status: 201,
                message: "Ruta creada exitosamente",
                route: {
                    id: newRoute.id,
                    name: newRoute.name,
                    working_days: newRoute.working_days,
                    seller: sellerData,
                    stores: []
                }
            });

        } catch (error) {
            console.error("❌ Error al crear ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al crear la ruta"
            });
        }
    },

    // 📌 Método para actualizar una ruta
    async updateRoute(req, res) {
        console.log("📌 Intentando actualizar una ruta...");

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
            route.user_id = user_id !== undefined ? user_id : route.user_id; // Permitir null explícito
            route.working_days = working_days || route.working_days;

            await route.save();

            // 🔹 Si hay vendedor asignado, obtener sus datos completos
            let sellerData = null;
            if (route.user_id) {
                const routeWithSeller = await routes.findByPk(route.id, {
                    include: [
                        {
                            model: users,
                            as: 'seller',
                            attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],
                            include: [
                                {
                                    model: roles,
                                    as: 'role',
                                    attributes: ['id', 'name']
                                }
                            ]
                        }
                    ]
                });

                if (routeWithSeller && routeWithSeller.seller) {
                    // Procesar el teléfono para separar código de país y número
                    let countryCode = undefined;
                    let phoneNumber = undefined;

                    if (routeWithSeller.seller.phone) {
                        if (routeWithSeller.seller.phone.includes('-')) {
                            [countryCode, phoneNumber] = routeWithSeller.seller.phone.split('-');
                        } else {
                            phoneNumber = routeWithSeller.seller.phone;
                        }
                    }

                    sellerData = {
                        id: routeWithSeller.seller.id,
                        email: routeWithSeller.seller.email,
                        name: routeWithSeller.seller.first_name,
                        lastName: routeWithSeller.seller.last_name,
                        countryCode: countryCode,
                        phone: phoneNumber,
                        status: routeWithSeller.seller.status,
                        role: {
                            id: routeWithSeller.seller.role.id,
                            name: routeWithSeller.seller.role.name
                        }
                    };
                }
            }

            console.log("✅ Ruta actualizada:", route);

            res.status(200).json({
                success: true,
                status: 200,
                message: "Ruta actualizada exitosamente",
                route: {
                    id: route.id,
                    name: route.name,
                    working_days: route.working_days,
                    seller: sellerData,
                    
                }
            });

        } catch (error) {
            console.error("❌ Error al actualizar ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al actualizar la ruta"
            });
        }
    },

    // 📌 Método para eliminar una ruta
    async deleteRoute(req, res) {
        console.log("📌 Intentando eliminar una ruta...");

        try {
            const { id } = req.params;

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























    //📌 Endpoint para obtener las tiendas de una ruta
    async getStoresByRoute(req, res) {
        try {
            const { id } = req.params; // se espera que la URL sea /routes/:id/stores
            const route = await routes.findByPk(id, {
                include: [
                    {
                        model: users,
                        as: 'seller',
                        attributes: ['id', 'name', 'email', 'phone', 'status'],
                        include: [
                            {
                                model: roles,
                                as: 'role',
                                attributes: ['id', 'name'],
                            },
                        ],
                    },
                    {
                        model: stores,
                        as: 'stores',
                        attributes: ['id', 'name', 'address', 'phone', 'image_url', 'latitude', 'longitude', 'opening_time', 'closing_time', 'neighborhood'],
                        include: [
                            {
                                model: store_types,
                                as: 'store_type',
                                attributes: ['id', 'name', 'description'],
                            },
                            {
                                model: users,
                                as: 'manager',
                                attributes: ['id', 'name', 'email', 'phone', 'status']
                            }
                        ],
                    },
                ],
            });
            if (!route) {
                return res.status(404).json({ error: "Ruta no encontrada." });
            }
            res.status(200).json(route.stores);
        } catch (error) {
            console.error("❌ Error al obtener tiendas de la ruta:", error);
            res.status(500).json({ error: "Error al obtener tiendas de la ruta." });
        }
    },



    

    
};

