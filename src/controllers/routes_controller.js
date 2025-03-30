const { routes, users, stores, store_types, roles } = require('../models');

module.exports = {
    // 📌 Método para obtener todas las rutas
    async getListRoutes(req, res) {
        console.log("📌 Intentando obtener todas las rutas...");

        try {
            const routesList = await routes.findAll({
                attributes: ['id', 'name', 'working_days'],
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
                ],
            });
            console.log("✅ Rutas obtenidas:", routesList);
            res.status(200).json(routesList);
        } catch (error) {
            console.error("❌ Error al obtener rutas:", error);
            res.status(500).json({ error: "Error al obtener rutas." });
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

    // 📌 Método para crear una ruta
    async createRoute(req, res) {
        console.log("📌 Intentando crear una ruta...");

        try {
            const { name, user_id, working_days } = req.body;

            if (!name) {
                return res.status(400).json({ error: "El nombre de la ruta es requerido." });
            }

            //buscamos si la ruta ya existe
            const routeExists = await routes.findOne({ where: { name } });
            if (routeExists) {
                return res.status(400).json({ error: "La ruta ya existe." });
            }

            const newRoute = await routes.create({ name, user_id, working_days });
            console.log("✅ Ruta creada:", newRoute);
            res.status(201).json(newRoute);
        } catch (error) {
            console.error("❌ Error al crear ruta:", error);
            res.status(500).json({ error: "Error al crear ruta." });
        }
    },

    // 📌 Método para actualizar una ruta
    async updateRoute(req, res) {
        console.log("📌 Intentando actualizar una ruta...");

        try {
            const { id } = req.params;
            const { name, user_id, working_days } = req.body;

            if (!name) {
                return res.status(400).json({ error: "El nombre de la ruta es requerido." });
            }

            const route = await routes.findByPk(id);

            if (!route) {
                return res.status(404).json({ error: "La ruta no existe." });
            }

            route.name = name || route.name;
            route.user_id = user_id || route.user_id;
            route.working_days = working_days || route.working_days;

            await route.save();
            console.log("✅ Ruta actualizada:", route);
            await route.reload({
                attributes: ['id', 'name', 'working_days'],
                include: [
                    {
                        model: users,       // Asegúrate de haber importado el modelo users
                        as: 'seller',       // El alias definido en la asociación
                        attributes: ['id', 'name', 'email', 'phone', 'status'],
                        include: [
                            {
                                model: roles,
                                as: 'role',
                                attributes: ['id', 'name'],
                            },
                        ],
                    },
                ],
            });

            const updatedRoute = {
                id: route.id,
                name: route.name,
                working_days: route.working_days,
                seller: route.seller ? { id: route.seller.id, name: route.seller.name } : null,
            };

            res.status(200).json(updatedRoute);
        } catch (error) {
            console.error("❌ Error al actualizar ruta:", error);
            res.status(500).json({ error: "Error al actualizar ruta." });
        }
    },

    // 📌 Método para eliminar una ruta
    async deleteRoute(req, res) {
        console.log("📌 Intentando eliminar una ruta...");

        try {
            const { id } = req.params;

            const route = await routes.findByPk(id);

            if (!route) {
                return res.status(404).json({ error: "La ruta no existe." });
            }

            await route.destroy();
            console.log("✅ Ruta eliminada:", route);
            res.status(200).json({ message: "Ruta eliminada exitosamente." });
        } catch (error) {
            console.error("❌ Error al eliminar ruta:", error);
            res.status(500).json({ error: "Error al eliminar ruta." });
        }
    },
};

