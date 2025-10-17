const express = require('express');
const { salesController } = require('../controllers');
const { verifyToken, checkPermission, checkAnyPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING
const {
    createGeneralLimiter,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/sales/



// 📌 RUTAS PARA NUEVAS VENTAS

// 🛡️ Rate limiter personalizado para creación de ventas (prevenir spam)
const createSaleLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 35,               // 35 ventas por hora por IP
    maxByUser: 50,             // 50 ventas por hora por usuario
    message: "Límite de creación de ventas alcanzado"
});

/**
 * 🛒 RUTAS DE VENTAS
 * Todas las rutas requieren autenticación JWT
 */

/**
 * @route   POST /api/sales
 * @desc    Crear una nueva venta
 * @access  Privado (Autenticado)
 * @body    { subtotal, tax_amount, discount_amount, total_amount, store_id, payment_method_id, route_id?, visit_id? }
 */
router.post('/createSale',
    verifyToken,
    createSaleLimiter,
    checkPermission('create_new_sale_in_route'), // permiso en la base de datos para crear ventas
    salesController.createSale
);



module.exports = router;