const { route_types, companies } = require('../models');

module.exports = {

    // 📌 Método para obtener los tipos de rutas de una compañía
    async getRouteTypesByCompany(req, res) {
        try {
            const { company_id } = req.params;

            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    routeTypes: []
                });
            }

            // 🔹 Obtener tipos de rutas (globales + de la compañía)
            const routeTypesList = await route_types.findAll({
                where: {
                    // Tipos globales O tipos específicos de la compañía
                    [require('sequelize').Op.or]: [
                        { is_global: true, is_active: true },
                        { company_id: company_id, is_active: true }
                    ]
                },
                attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global'],
                order: [['display_order', 'ASC'], ['name', 'ASC']]
            });

            // 🔹 Si no hay tipos de rutas, devolver lista vacía
            if (!routeTypesList.length) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: "No se encontraron tipos de rutas disponibles",
                    routeTypes: []
                });
            }

            res.status(200).json({
                success: true,
                status: 200,
                message: "Tipos de rutas cargados exitosamente",
                routeTypes: routeTypesList
            });

        } catch (error) {
            console.error("❌ Error al obtener tipos de rutas:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor",
                routeTypes: []
            });
        }
    }
};
