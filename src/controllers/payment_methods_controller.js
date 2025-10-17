const { payment_methods } = require('../models');
const { Op } = require('sequelize'); // 🔧 Importar Op para operadores

module.exports = {
    // 📥 Obtener métodos de pago para una compañía específica
    // Retorna: métodos globales (sistema) + métodos específicos de la compañía
    // Ordenados: primero globales, luego por nombre alfabético
    getPaymentMethodsByCompany: async (req, res) => {
        const { companyId } = req.params;
        
        try {
            // 🔍 Validar que se proporcionó companyId
            if (!companyId) {
                return res.status(400).json({ 
                    success: false,
                    message: 'El ID de la compañía es requerido' 
                });
            }

            // 📋 Consultar métodos de pago activos
            const paymentMethods = await payment_methods.findAll({
                where: {
                    is_active: true, // Solo métodos activos
                    [Op.or]: [
                        { is_global: true },           // Métodos globales (sistema)
                        { company_id: companyId }      // Métodos específicos de la compañía
                    ]
                },
                order: [
                    ['is_global', 'DESC'],  // 🌍 Globales primero (true antes que false)
                    ['name', 'ASC']         // 📝 Luego por nombre alfabético A-Z
                ],
                attributes: [
                    'id',
                    'name', 
                    'company_id',
                    'is_global',
                    'is_active',
                    'commission',
                    'created_at',
                    'updated_at'
                ]
            });            

            // ✅ Respuesta exitosa
            return res.status(200).json({
                success: true,
                status: 200,                
                message: 'Métodos de pago obtenidos correctamente',
                paymentMethods: paymentMethods
            });

        } catch (error) {
            console.error('❌ Error al obtener métodos de pago:', error);
            
            // 🚨 Respuesta de error
            return res.status(500).json({ 
                success: false,
                message: 'Error interno del servidor al obtener métodos de pago',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
            });
        }
    }
}