const { no_sale_categories, no_sale_reasons } = require('../models');

module.exports = {

    // Obtener todas las no_sale_categories de una compañia
    // Primero las propias de la compañia y luego las globales
    getCategoriesByCompany: async (req, res) => {
        try {
            const { companyId } = req.params;

            // Validar que el companyId esté presente
            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El ID de la compañía es requerido',
                    data: []
                });
            }

            // 🚀 EAGER LOADING: Obtener categories + reasons en una sola consulta
            const { Op } = require('sequelize');
            const categories = await no_sale_categories.findAll({
                where: {
                    [Op.or]: [
                        { is_global: true },
                        { company_id: companyId }
                    ],
                    is_active: true
                },
                include: [
                    {
                        model: no_sale_reasons,
                        as: 'reasons',
                        where: {
                            is_active: true
                        },
                        required: false, // LEFT JOIN - incluir categories sin reasons
                        order: [['id', 'ASC']]
                    }
                ],
                order: [
                    ['is_global', 'DESC'], // Primero las de la compañía, después globales
                    ['id', 'ASC'],         // Dentro de cada grupo, por ID ascendente
                    [{ model: no_sale_reasons, as: 'reasons' }, 'id', 'ASC'] // Reasons ordenados por ID
                ]
            });


            // 🎯 Formatear respuesta completa con reasons incluidos
            const formattedCategories = categories.map(category => ({
                id: category.id,
                name: category.name,
                is_global: category.is_global,
                company_id: category.company_id, // Puede ser null en la globales
                is_active: category.is_active,
                description: category.description,
                reasons: category.reasons ? category.reasons.map(reason => ({
                    id: reason.id,
                    name: reason.name,
                    category_id: reason.category_id,
                    is_active: reason.is_active,
                    description: reason.description,
                    is_global: reason.is_global,
                    // ❌ Excluimos created_at y updated_at
                })) : []
                // ❌ Excluimos created_at y updated_at de categories
            }));

            res.status(200).json({
                success: true,
                status: 200,
                message: 'La carga de datos fue exitosa',
                data: formattedCategories                
            });

        } catch (error) {
            console.error("❌ Error en getCategoriesByCompany:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al obtener las categorías',
                data: []
            });
        }
    }
}