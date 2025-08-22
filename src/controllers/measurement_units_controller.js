const { measurement_units } = require('../models');

module.exports = {


    // 📌 Obtener todas las unidades de medida ordenadas por id
    async list(req, res) {
      
        try {
            const allMeasurementUnits = await measurement_units.findAll({
                order: [['id', 'ASC']], // 🔹 Ordenar por id de forma ascendente
            });
            res.status(200).json(allMeasurementUnits);
        } catch (error) {
            console.error("❌ Error obteniendo unidades de medida:", error);
            res.status(400).json({ error: error.message });
        }
    },
};


