const { inventory_supplies_balance, inventory_supplies } = require("../models");

module.exports = {
    // 📌 Método para obtener el balance de todos los insumos
    async getListInventorySuppliesBalance(req, res) {
        console.log("📌 Intentando obtener el balance de todos los insumos...");

        try {
            const balances = await inventory_supplies_balance.findAll({
                include: [
                    {
                        model: inventory_supplies,
                        as: "inventory_supply"
                    } 
                ],
                order: [["balance", "ASC"]]
            });

            console.log("✅ Balances obtenidos:", balances);
            res.status(200).json(balances);
        } catch (error) {
            console.error("❌ Error al obtener balances:", error);
            res.status(500).json({ error: "Error al obtener balances de insumos." });
        }
    }
};