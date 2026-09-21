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

/**
 * 🛡️ Limitador de creación de ventas.
 *
 * 🔴 EL CUPO SE MIDE CONTRA UN DÍA ENTERO, NO CONTRA UNA HORA DE TRABAJO. Cuando el vendedor pasa
 * la jornada sin señal, la cola se vacía **de golpe** al recuperarla: las ventas de todo el día
 * llegan dentro de la misma hora. Un cupo pensado para el ritmo real de la calle deja fuera
 * exactamente el caso que esta aplicación existe para cubrir.
 *
 * Estaba en 50/hora y el pico real medido sobre toda la historia (2026-09-16) es de **49 ventas
 * en un día** para un vendedor: el margen era de una. Ahora va a **3× el pico**, que absorbe el
 * día completo más los reintentos y sigue siendo un techo bajo para un bucle descontrolado.
 *
 * ⚠️ `maxByIP` solo se aplica a peticiones SIN autenticar (`keyGenerator` usa `user:<id>` en
 * cuanto hay sesión, y aquí `verifyToken` va antes), así que en la práctica no gobierna nada.
 * Se deja coherente para que nadie lo lea como el límite real.
 */
const createSaleLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 35,
    maxByUser: 150,            // 3× el pico real de un vendedor en un día (49)
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

/**
 * @route   GET /api/sales/detail/:sale_id
 * @desc    Una venta con el detalle de sus líneas. Alimenta el cajón de detalle del Cuadre y del
 *          Historial, y más adelante la reimpresión del ticket.
 * @access  Privado — 'view_sales_history' O 'view_sales_reconciliation'
 *
 * 🔴 EL PERMISO ES `checkAnyPermission` A PROPÓSITO: la misma pregunta —qué llevaba esta venta—
 * se hace desde DOS pantallas con permisos distintos (el Historial usa `view_sales_history`, el
 * Cuadre usa `view_sales_reconciliation`). Exigir uno solo dejaría el cajón muerto en la otra.
 *
 * ⚠️ El prefijo literal `/detail/` evita cualquier choque con `/list`, `/reports/...`,
 * `/createSale` y `/pos-catalog`. Con un `/:sale_id` suelto, esta ruta capturaría a las demás
 * según el orden del archivo.
 */
router.get('/detail/:sale_id',
    verifyToken,
    reportsLimiter,
    checkAnyPermission(['view_sales_history', 'view_sales_reconciliation']),
    salesReportsController.getSaleDetail
);

/**
 * @route   GET /api/sales/reports/conflicts
 * @desc    Ventas con conflicto: llegaron cuando ya no cabían y se guardaron apartadas.
 *          SIN filtro de fecha a propósito — es una lista de tareas, no un informe.
 * @query   limit? (máx. 200)
 * @access  Privado — permiso 'view_sales_history' (mismo que el historial: son ventas)
 */
router.get('/reports/conflicts',
    verifyToken,
    reportsLimiter,
    checkPermission('view_sales_history'),
    salesReportsController.getConflictSales
);



module.exports = router;