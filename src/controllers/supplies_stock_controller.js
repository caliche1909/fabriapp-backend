const { config } = require('dotenv');
const { supplies_stock, inventory_supplies, users, roles } = require('../models');
const { or } = require('sequelize');

module.exports = {

    // 📌 Método insertar un mobimiento de entrada o salida de insumos
    async insertSuppliesStock(req, res) {
        console.log("📌 Intentando insertar un movimiento de stock de insumos...", req.body);
        try {
            // Extraer los datos del cuerpo de la solicitud
            const { inventory_supply, quantity_change_gr_ml_und, transaction_type, description, user } = req.body;

            // Validar que los datos requeridos estén presentes
            if (!inventory_supply?.id || !quantity_change_gr_ml_und || !transaction_type ) {
                return res.status(400).json({ message: "❌ Datos incompletos para registrar movimiento" });
            }

            const userId = user?.id ?? null;

            // Insertar el nuevo movimiento en la base de datos
            const newStockMovement = await supplies_stock.create({
                inventory_supply_id: inventory_supply.id,
                quantity_change_gr_ml_und,
                transaction_type,
                description: description || null,
                user_id: userId
                
            });

            console.log("✅ Movimiento registrado en la base de datos:", newStockMovement);
            return res.status(201).json(newStockMovement);

        } catch (error) {
            console.error("❌ Error al registrar movimiento:", error);
            return res.status(500).json({ message: "❌ Error interno del servidor" });
        }
    },



    // 📌 Método para obtener los últimos movimientos de stock de un insumo específico
    async getSuppliesStockBySupplyId(req, res) {
        console.log("📌 Intentando obtener movimientos de stock para un insumo específico...");

        try {
            // Extraer el ID del insumo desde los parámetros de la URL
            const { supplyId } = req.params;

            if (!supplyId) {
                return res.status(400).json({ error: "Se requiere el ID del insumo" });
            }

            console.log(`🔍 Buscando movimientos de stock para el insumo ID: ${supplyId}`);

            // Consultar los últimos 20 movimientos de stock del insumo específico
            const stockMovements = await supplies_stock.findAll({
                where: { inventory_supply_id: supplyId },
                include: [
                    {
                        model: inventory_supplies,
                        as: "inventory_supply"
                    },
                    {
                        model: users,  // 🔹 Incluir información del usuario
                        as: "user",
                        attributes: ["name"], // Seleccionar solo los datos relevantes
                        required: false, // 🔹 Hacer la relación opcional
                        include: [{
                            model: roles,
                            as: "role",
                            attributes: ["name"] // Seleccionar solo los datos relevantes
                        }]
                    }
                ],
                order: [['transaction_date', 'DESC']], // Ordenar del más reciente al más antiguo
                limit: 20 // Limitar a los últimos 20 registros
            });

            console.log(`✅ Movimientos encontrados (${stockMovements.length}):`, stockMovements);

            return res.status(200).json(stockMovements);

        } catch (error) {
            console.error("❌ Error al obtener los movimientos de stock:", error);
            return res.status(500).json({ message: "❌ Error interno del servidor" });
        }
    }



}