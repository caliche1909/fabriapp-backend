const { routes, users, stores, store_types, roles } = require('../models');

module.exports = {
    // 📌 Método para obtener todas las rutas
    async getListRoutes(req, res) {
        console.log("📌 Intentando obtener todas las rutas...");

        try {
            const routesList = await routes.findAll({
                attributes: ['id', 'name'],
                include: [
                    {
                        model: users,
                        as: 'user',
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
                        attributes: ['id', 'name', 'address', 'phone', 'image_url', 'latitude', 'longitude', 'opening_time', 'closing_time'],
                        include: [
                            {
                                model: store_types,
                                as: 'store_type',
                                attributes: ['id', 'name', 'description'],
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

    // 📌 Método para crear una ruta
    async createRoute(req, res) {
        console.log("📌 Intentando crear una ruta...");

        try {
            const { name, user_id } = req.body;

            if (!name) {
                return res.status(400).json({ error: "El nombre de la ruta es requerido." });
            }

            //buscamos si la ruta ya existe
            const routeExists = await routes.findOne({ where: { name } });
            if (routeExists) {
                return res.status(400).json({ error: "La ruta ya existe." });
            }

            const newRoute = await routes.create({ name, user_id });
            console.log("✅ Ruta creada:", newRoute);
            res.status(201).json(newRoute);
        } catch (error) {
            console.error("❌ Error al crear ruta:", error);
            res.status(500).json({ error: "Error al crear ruta." });
        }
    },
};

