const express = require('express');
const { inventory_supplies_balanceController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA BALANCES DE INVENTARIO
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA BALANCES DE STOCK
// Consulta frecuente y crítica para monitoreo de inventario en tiempo real
const stockBalancesLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 25,                     // 25 por IP (fallback)
    maxByUser: 75,                   // 75 consultas por usuario (generoso para monitoreo)
    message: "Límite de consultas de balances de stock alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true,    // Solo contar consultas fallidas
    enableOwnerBonus: true           // OWNERS pueden consultar más (supervisión)
});

// api/balance_inventory_supplies/

// 📊 OBTENER BALANCES DE STOCK - Límite generoso (consulta frecuente crítica)
// Para monitoreo constante de existencias de insumos
router.get('/list/:company_id',
    verifyToken,
    stockBalancesLimiter,            // 75 consultas/15min (monitoreo frecuente)
    checkPermission('view-supplies-stock'), // permiso en la base de datos para ver los balances de inventario de insumos
    inventory_supplies_balanceController.getListInventorySuppliesBalance
);

module.exports = router;