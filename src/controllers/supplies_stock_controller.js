const { config } = require('dotenv');
const { supplies_stock } = require('../models');

module.exports = {

    // 📌 Método insertar un mobimiento de entrada o salida de insumos
    async insertSuppliesStock(req, res) {
        console.log("📌 Intentando insertar un movimiento de stock de insumos...", req.body);
        try {
            // Extraer los datos del cuerpo de la solicitud
            const { inventory_supply, quantity_change_gr_ml_und, transaction_type, description } = req.body;

            // Validar que los datos requeridos estén presentes
            if (!inventory_supply?.id || !quantity_change_gr_ml_und || !transaction_type) {
                return res.status(400).json({ message: "❌ Datos incompletos para registrar movimiento" });
            }

            // Insertar el nuevo movimiento en la base de datos
            const newStockMovement = await supplies_stock.create({
                inventory_supply_id: inventory_supply.id,
                quantity_change_gr_ml_und,
                transaction_type,
                description: description || null,
            });

            console.log("✅ Movimiento registrado en la base de datos:", newStockMovement);
            return res.status(201).json(newStockMovement);

        } catch (error) {
            console.error("❌ Error al registrar movimiento:", error);
            return res.status(500).json({ message: "❌ Error interno del servidor" });
        }
    },


}