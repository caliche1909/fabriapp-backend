const express = require('express');
const { supplies_stockController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING EXISTENTES PARA PERSONALIZAR
const {
    createGeneralLimiter,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/supplies_stock/

// 🛡️ LIMITADORES PERSONALIZADOS PARA STOCK DE INSUMOS
// Registrar movimiento - Basado en createGeneralLimiter pero más generoso (operativo)
const registerStockMovementLimiter = createGeneralLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 30,                   // 30 movimientos por IP
    maxByUser: 80,                 // 80 movimientos por usuario (operativo frecuente)
    message: "Límite de registro de movimientos de stock alcanzado",
    enableOwnerBonus: true,        // OWNERS: 120 movimientos/15min
    skipSuccessfulRequests: false  // Contar todos los movimientos (auditoría)
});

// Ver movimientos - Basado en createQueryLimiter para consultas de auditoría
const viewStockMovementsLimiter = createQueryLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 40,                   // 40 consultas por IP
    maxByUser: 120,                // 120 consultas por usuario (auditoría/reportes)
    message: "Límite de consulta de movimientos de stock alcanzado",
    enableOwnerBonus: true         // OWNERS: 180 consultas/15min
});

router.post('/registerMovement', 
    verifyToken, 
    registerStockMovementLimiter, // 🔒 80 movimientos/15min (operativo frecuente)
    checkPermission('update-supplies-stock'), 
    supplies_stockController.insertSuppliesStock
);

router.get('/movements/:supplyId', 
    verifyToken, 
    viewStockMovementsLimiter, // 🔒 120 consultas/15min (auditoría/reportes)
    checkPermission('view-movements-supplies-stock'), 
    supplies_stockController.getSuppliesStockBySupplyId
);

module.exports = router;

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. update-supplies-stock -> Permite actualizar el stock de un insumo con un movimiento
    2. view-movements-supplies-stock -> Permite ver los movimientos de stock de un insumo
*/