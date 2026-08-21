const { inventory_supplies_balance, inventory_supplies, measurement_units, supplier_companies } = require("../models");

module.exports = {
    // 📌 Método para obtener el balance de insumos de una compañía específica
    async getListInventorySuppliesBalance(req, res) {
        
        try {
            // 🔒 SEGURIDAD MULTI-TENANT: la compañía SIEMPRE se deriva del usuario autenticado
            // (req.user.companyId), NUNCA del parámetro de la URL. Antes se usaba req.params.company_id,
            // lo que permitía que cualquier usuario autenticado leyera los balances de OTRA compañía
            // (IDOR). El :company_id de la ruta se mantiene por compatibilidad pero se ignora.
            const company_id = req.user.companyId;

            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Se requiere el ID de la compañía",
                    balances: []
                });
            }

            // 🔹 Obtener balances filtrados directamente por company_id (OPTIMIZADO)
            const balances = await inventory_supplies_balance.findAll({
                where: {
                    company_id: company_id // 🎯 FILTRO DIRECTO POR COMPAÑÍA (sin JOIN)
                },
                include: [
                    {
                        model: inventory_supplies,
                        as: "inventory_supply",
                        attributes: [
                            'id',
                            'name',
                            'minimum_stock',

                        ],
                        include: [
                            {
                                model: measurement_units,
                                as: 'packaging_unit',
                                attributes: ['id', 'name', 'abbreviation']
                            }

                        ]
                    }
                ],
                attributes: ['id', 'balance', 'last_updated'], // Incluir company_id
                order: [["balance", "ASC"]] // Ordenar por balance ascendente (críticos primero)
            });

            // 🔹 Verificar si se encontraron balances
            if (balances.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "No se encontraron balances para esta compañía",
                    balances: []
                });
            }

            // 🔹 Formatear respuesta optimizada
            const formattedBalances = balances.map(balance => ({
                id: balance.id,
                balance: parseFloat(balance.balance),
                last_updated: balance.last_updated,
                inventory_supply: {
                    id: balance.inventory_supply.id,
                    name: balance.inventory_supply.name,
                    minimum_stock: parseFloat(balance.inventory_supply.minimum_stock)                    
                }
            }));

            

            res.status(200).json({
                success: true,
                message: "Balances obtenidos exitosamente",
                balances: formattedBalances                
            });

        } catch (error) {
            console.error("❌ Error al obtener balances:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error al obtener balances de insumos",
                balances: []
            });
        }
    }
};