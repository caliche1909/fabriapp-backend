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

/**
 * @route   GET /api/sales/pos-catalog
 * @desc    Qué puede vender AHORA el usuario: modo de la compañía + bodega (si aplica) +
 *          productos con su disponible (null cuando no hay control de inventario).
 * @access  Privado — MISMO permiso que registrar la venta ('create_new_sale_in_route').
 *          A propósito NO se gatea con permisos de inventario: quien puede vender debe poder
 *          cargar lo que vende, aunque no tenga acceso al módulo de inventario.
 */
router.get('/pos-catalog',
    verifyToken,
    createQueryLimiter(),
    checkPermission('create_new_sale_in_route'),
    salesController.getPosCatalog
);



// 📊 RUTAS DE REPORTES Y ANALÍTICA (solo lectura)
// Todas filtran por la compañía del usuario autenticado. Los owners tienen
// acceso total; los colaboradores requieren el permiso indicado.

const reportsLimiter = createQueryLimiter();

/**
 * @route   GET /api/sales/reports/summary
 * @desc    KPIs generales + top vendedores/tiendas (Dashboard)
 * @query   from?=YYYY-MM-DD, to?=YYYY-MM-DD
 * @access  Privado — permiso 'view_sales_dashboard'
 */
router.get('/reports/summary',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_dashboard'),
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
 * @access  Privado — permiso 'view_no_sale_reports'
 */
router.get('/reports/no-sale',
    verifyToken,
    reportsLimiter,
    checkPermission('view_no_sale_reports'),
    salesReportsController.getNoSaleReport
);

/**
 * @route   GET /api/sales/reports/no-sale/detail
 * @desc    Lista paginada de reportes de no-venta INDIVIDUALES (detalle/drill-down)
 * @query   from?, to?, page?, limit?, categoryId?, reasonId?, sellerId?, storeId?
 * @access  Privado — permiso 'view_no_sale_reports'
 */
router.get('/reports/no-sale/detail',
    verifyToken,
    reportsLimiter,
    checkPermission('view_no_sale_reports'),
    salesReportsController.getNoSaleReportDetail
);

/**
 * @route   GET /api/sales/reports/sellers
 * @desc    Lista de vendedores (miembros activos) para el selector del Cuadre
 * @access  Privado — permiso 'view_sales_reconciliation'
 */
router.get('/reports/sellers',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_reconciliation'),
    salesReportsController.getSellers
);

/**
 * @route   GET /api/sales/reports/cuadre
 * @desc    Cuadre de ventas: visitas del período (con/sin venta), resumen por
 *          vendedor y montos a cobrar por método de pago. Por defecto HOY.
 * @query   from?, to?, user_id?
 * @access  Privado — permiso 'view_sales_reconciliation'
 */
router.get('/reports/cuadre',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_reconciliation'),
    salesReportsController.getCuadre
);

/**
 * @route   GET /api/sales/reports/lost-opportunity
 * @desc    Oportunidad perdida del período: no-ventas y visitas planificadas no
 *          realizadas, con una ESTIMACIÓN de lo que se dejó de vender (referencia:
 *          el promedio de compra de cada tienda). Por defecto HOY.
 * @query   from?, to?, user_id?
 * @access  Privado — permiso 'view_sales_reconciliation' (vive en el Cuadre)
 */
router.get('/reports/lost-opportunity',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_reconciliation'),
    salesReportsController.getLostOpportunity
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