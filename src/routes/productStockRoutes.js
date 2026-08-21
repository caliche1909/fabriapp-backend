const express = require('express');
const { productStockController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA STOCK DE PRODUCTOS
const {
    createSmartRateLimit,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const listStockLimiter = createQueryLimiter({ trustedIPs: [] });

const movementLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 40,
    maxByUser: 120,
    message: 'Límite de movimientos de stock alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

/**
 * PERMISOS (submódulo `products-stock`): view_products_stock, create_products_stock.
 * La compañía SIEMPRE de la sesión (req.user.companyId). Owners bypassan checkPermission.
 */

// api/products_stock/

// 📋 Saldos de la bodega central (?search=)
router.get('/balances',
    verifyToken,
    listStockLimiter,
    checkPermission('view_products_stock'),
    productStockController.getProductStockBalances
);

// 📍 Saldos de una bodega específica (?search=)
router.get('/balances/location/:locationId',
    verifyToken,
    listStockLimiter,
    checkPermission('view_products_stock'),
    productStockController.getBalancesByLocation
);

// 🕓 Histórico de movimientos de un producto
router.get('/movements/:productId',
    verifyToken,
    listStockLimiter,
    checkPermission('view_products_stock'),
    productStockController.getProductMovements
);

// ➕ Registrar ENTRADA / SALIDA / AJUSTE (bodega CENTRAL)
router.post('/movement',
    verifyToken,
    movementLimiter,
    checkPermission('create_products_stock'),
    productStockController.registerMovement
);

// 🔧 AJUSTE (+/−) en una bodega ESPECÍFICA. Autorización en el controlador (3 niveles:
// owner / `create_products_stock` / responsable de la bodega), por eso NO lleva checkPermission.
router.post('/movement/location/:locationId',
    verifyToken,
    movementLimiter,
    productStockController.adjustLocationStock
);

module.exports = router;
