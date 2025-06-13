const { companies } = require('../models');

module.exports = {
    // 📌 METODO PARA ACTUALIZAR EL IS_DEFAULT DE LA EMPRESA A TRUE
    async updateIsDefaultTrue(req, res) {
        try {
            const { id } = req.params;
            
            console.log(`📌 Intentando establecer compañía ${id} como predeterminada...`);

            // Verificar que la compañía existe
            const company = await companies.findByPk(id);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Compañía no encontrada'
                });
            }

            // Verificar que la compañía está activa
            if (!company.is_active) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'No se puede establecer como predeterminada una compañía inactiva'
                });
            }

            // Actualizar is_default a true (el trigger se encargará del resto)
            await company.update({ is_default: true });            

            res.status(200).json({
                success: true,
                status: 200,
                message: `La compañía ${company.name} esta operando`,                
            });

        } catch (error) {
            console.error('❌ Error al actualizar is_default:', error);
            res.status(500).json({ 
                success: false,
                status: 500,
                message: 'Error interno del servidor al actualizar la compañía predeterminada',
                error: error.message 
            });
        }
    }
};