const { config } = require('dotenv');
const { supplies_stock, inventory_supplies, users } = require('../models');
const { or } = require('sequelize');

module.exports = {

    // 📌 Método insertar un mobimiento de entrada o salida de insumos
    async insertSuppliesStock(req, res) {

        try {
            // Extraer los datos del cuerpo de la solicitud
            const { inventory_supply, quantity_change_gr_ml_und, transaction_type, description } = req.body;

            // Validar que los datos requeridos estén presentes
            if (!inventory_supply?.id || !quantity_change_gr_ml_und || !transaction_type) {
                return res.status(400).json({ message: "❌ Datos incompletos para registrar movimiento" });
            }

            // 🔒 INTEGRIDAD: el signo NO se confía al cliente. Antes el frontend mandaba la cantidad
            // ya con signo (SALIDA → negativa) y el backend la guardaba tal cual, así que un cliente
            // podía mandar una "ENTRADA" negativa (baja stock) o una "SALIDA" positiva (sube stock),
            // dejando transaction_type como una etiqueta puramente cosmética. Ahora el servidor toma
            // la MAGNITUD y deriva el signo del transaction_type.
            if (transaction_type !== 'ENTRADA' && transaction_type !== 'SALIDA') {
                return res.status(400).json({ message: "❌ Tipo de movimiento inválido (debe ser ENTRADA o SALIDA)" });
            }
            const magnitude = Math.abs(Number(quantity_change_gr_ml_und));
            if (!Number.isFinite(magnitude) || magnitude <= 0) {
                return res.status(400).json({ message: "❌ La cantidad debe ser un número mayor que 0" });
            }
            const signedQuantity = transaction_type === 'SALIDA' ? -magnitude : magnitude;

            // 🔒 SEGURIDAD MULTI-TENANT: verificar que el insumo pertenezca a la compañía del
            // usuario autenticado antes de escribir. Sin esto, un usuario podía registrar movimientos
            // (y alterar el balance vía trigger) sobre insumos de OTRA compañía conociendo su id
            // autoincremental. La tabla supplies_stock no tiene company_id, así que la pertenencia
            // se comprueba contra inventory_supplies.company_id.
            const supplyOwned = await inventory_supplies.findOne({
                where: { id: inventory_supply.id, company_id: req.user.companyId },
                attributes: ['id']
            });

            if (!supplyOwned) {
                return res.status(404).json({ message: "❌ Insumo no encontrado" });
            }

            // 🔒 AUDITORÍA: la autoría del movimiento se toma de la sesión (req.user.id), NUNCA del
            // body enviado por el cliente (antes se aceptaba user.id del frontend, falsificable).
            const userId = req.user.id;

            // Insertar el nuevo movimiento en la base de datos
            const newStockMovement = await supplies_stock.create({
                inventory_supply_id: inventory_supply.id,
                quantity_change_gr_ml_und: signedQuantity,
                transaction_type,
                description: description || null,
                user_id: userId

            });

            return res.status(201).json(newStockMovement);

        } catch (error) {
            // El trigger/CHECK (balance >= 0) lanza check_violation (23514) si una SALIDA dejaría el
            // saldo en negativo (incluye la carrera concurrente que el UPDATE atómico ya no pierde).
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ message: "No hay suficiente stock disponible para registrar esta salida" });
            }
            console.error("❌ Error al registrar movimiento:", error);
            return res.status(500).json({ message: "❌ Error interno del servidor" });
        }
    },

    // 📌 Método para obtener los últimos movimientos de stock de un insumo específico
    async getSuppliesStockBySupplyId(req, res) {

        try {
            // Extraer el ID del insumo desde los parámetros de la URL
            const { supplyId } = req.params;

            if (!supplyId) {
                return res.status(400).json({
                    success: false,
                    message: "Se requiere el ID del insumo",
                    movements: []
                });
            }

            // 🔒 SEGURIDAD MULTI-TENANT: verificar que el insumo pertenezca a la compañía del usuario
            // autenticado antes de devolver su historial. Sin esto se podía leer los movimientos (con
            // nombres de usuarios) de insumos de OTRA compañía conociendo su id.
            const supplyOwned = await inventory_supplies.findOne({
                where: { id: supplyId, company_id: req.user.companyId },
                attributes: ['id']
            });

            if (!supplyOwned) {
                return res.status(404).json({
                    success: false,
                    message: "Insumo no encontrado",
                    movements: []
                });
            }

            // 🔥 CONSULTA SIMPLIFICADA: Solo usuario, sin roles
            const stockMovements = await supplies_stock.findAll({
                where: { inventory_supply_id: supplyId },
                attributes: [
                    'id',
                    'inventory_supply_id',
                    'transaction_type',
                    'quantity_change_gr_ml_und',
                    'transaction_date',
                    'description'
                ],
                include: [
                    {
                        model: users,
                        as: "user",
                        attributes: ["id", "first_name", "last_name"],
                        required: false // Hacer la relación opcional
                    }
                ],
                order: [['transaction_date', 'DESC']], // Del más reciente al más antiguo
                limit: 50 // Máximo 50 registros
            });

            // 🔥 FORMATEO SIMPLIFICADO: Sin roles específicos
            const formattedMovements = stockMovements.map(movement => ({
                id: movement.id,
                inventory_supply_id: movement.inventory_supply_id,
                transaction_type: movement.transaction_type,
                quantity_change_gr_ml_und: movement.quantity_change_gr_ml_und,
                transaction_date: movement.transaction_date,
                description: movement.description,
                inventory_supply: null, // Como solicitado
                user: movement.user ? {
                    id: movement.user.id,
                    name: movement.user.first_name,
                    lastName: movement.user.last_name
                } : null
            }));



            return res.status(200).json({
                success: true,
                message: "Movimientos obtenidos exitosamente",
                movements: formattedMovements
            });

        } catch (error) {
            console.error("❌ Error al obtener los movimientos de stock:", error);
            return res.status(500).json({
                success: false,
                message: "Error interno del servidor",
                movements: []
            });
        }
    }
}