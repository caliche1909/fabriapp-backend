const express = require('express');
const { salesController, salesReportsController } = require('../controllers');
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



// 📊 RUTAS DE REPORTES Y ANALÍTICA (solo lectura)
// Todas filtran por la compañía del usuario autenticado. Los owners tienen
// acceso total; los colaboradores requieren el permiso indicado.

const reportsLimiter = createQueryLimiter();

/**
 * @route   GET /api/sales/reports/summary
 * @desc    KPIs generales + top vendedores/tiendas (Dashboard)
 * @query   from?=YYYY-MM-DD, to?=YYYY-MM-DD
 * @access  Privado — permiso 'view_reports'
 */
router.get('/reports/summary',
    verifyToken,
    reportsLimiter,
    checkPermission('view_reports'),
    salesReportsController.getSummary
);

/**
 * @route   GET /api/sales/reports/analytics
 * @desc    Serie temporal + desglose por vendedor, tienda y método de pago
 * @query   from?, to?, granularity?=day|month|year
 * @access  Privado — permiso 'view_reports'
 */
router.get('/reports/analytics',
    verifyToken,
    reportsLimiter,
    checkPermission('view_reports'),
    salesReportsController.getAnalytics
);

/**
 * @route   GET /api/sales/reports/no-sale
 * @desc    Reportes de no-venta agregados por categoría y razón
 * @query   from?, to?
 * @access  Privado — permiso 'view_reports'
 */
router.get('/reports/no-sale',
    verifyToken,
    reportsLimiter,
    checkPermission('view_reports'),
    salesReportsController.getNoSaleReport
);

/**
 * @route   GET /api/sales/reports/sellers
 * @desc    Lista de vendedores (miembros activos) para los selectores
 * @access  Privado — permiso 'view_reports'
 */
router.get('/reports/sellers',
    verifyToken,
    reportsLimiter,
    checkPermission('view_reports'),
    salesReportsController.getSellers
);

/**
 * @route   GET /api/sales/reports/cuadre
 * @desc    Cuadre de ventas: visitas del período (con/sin venta), resumen por
 *          vendedor y montos a cobrar por método de pago. Por defecto HOY.
 * @query   from?, to?, user_id?
 * @access  Privado — permiso 'view_reports'
 */
router.get('/reports/cuadre',
    verifyToken,
    reportsLimiter,
    checkPermission('view_reports'),
    salesReportsController.getCuadre
);

/**
 * @route   GET /api/sales/list
 * @desc    Historial de ventas paginado con filtros
 * @query   from?, to?, store_id?, user_id?, payment_method_id?, page?, limit?
 * @access  Privado — permiso 'view_sales_history'
 */
router.get('/list',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_history'),
    salesReportsController.getSalesList
);



module.exports = router;