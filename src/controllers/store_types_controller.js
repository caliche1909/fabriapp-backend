const { store_types } = require('../models');

module.exports = {
    // 📌 Método para obtener todos los tipos de tiendas
    async getStoreTypes(req, res) {

        try {
            const storeTypesList = await store_types.findAll({
                attributes: ['id', 'name', 'description'],
            });
            res.status(200).json(storeTypesList);
        } catch (error) {
            console.error("❌ Error al obtener tipos de tiendas:", error);
            res.status(500).json({ error: "Error al obtener tipos de tiendas." });
        }
    },
};