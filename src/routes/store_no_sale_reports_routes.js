const express = require('express');
const router = express.Router();
const StoreNoSaleReportsController = require('../controllers/store_no_sale_reports_controller');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING
const {
    createGeneralLimiter
} = require('../middlewares/smartRateLimit.middleware');

// 📌 RUTAS PARA REPORTES DE NO-VENTA

/**
 * 🛡️ Limitador de creación de reportes de no-venta.
 *
 * 🔴 EL CUPO SE MIDE CONTRA UN DÍA ENTERO, NO CONTRA UNA HORA. Una jornada sin señal se vacía de
 * golpe al recuperarla, así que los reportes de todo el día llegan dentro de la misma hora.
 * Estaba en 25/hora y el pico real medido (2026-09-16) es de **25 en un día**: el vendedor que
 * más reporta estaba exactamente en el techo, y el 26.º recibía un 429. Ahora va a 3× el pico.
 *
 * ⚠️ `maxByIP` solo rige sin sesión, y aquí `verifyToken` va antes: en la práctica no gobierna.
 */
const createReportLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 15,
    maxByUser: 75,             // 3× el pico real de un vendedor en un día (25)
    message: "Límite de creación de reportes de no-venta alcanzado"
});

// POST /api/store_no_sale_reports - Crear un nuevo reporte de no-venta (usado por el
// vendedor desde DialogNoSaleReport). Es el ÚNICO endpoint de este dominio que consume
// el frontend. La consulta/detalle de reportes vive en el módulo de sales
// (GET /api/sales/reports/no-sale y .../no-sale/detail), scopeado por compañía y con
// checkPermission('view_reports').
router.post('/',
    verifyToken,
    createReportLimiter,
    StoreNoSaleReportsController.createNoSaleReport
);

// POST /api/store_no_sale_reports/annul - Anular un reporte para poder registrar la venta que el
// tendero pidió después de haber dicho que no. El reporte NO se borra: se marca (§14).
//
// 🔴 EL PERMISO ES EL DE LA ACCIÓN QUE SE ESTÁ HACIENDO, NO EL DEL DATO QUE SE TOCA. Anular aquí
// es el primer paso de registrar una venta en ruta, así que lo gobierna
// `create_new_sale_in_route` — el mismo que abre el punto de venta. No se crea un permiso nuevo y
// NO se exige ninguno de los de informes de no-venta, que son de supervisión. Misma regla que se
// aplicó al desplegable de encargado el 2026-09-15 (`PENDING-IMPLEMENTATION.md` §3).
//
// La autorización de FONDO —solo el encargado actual de la ruta opera sobre sus visitas— la pone
// `autorizarSobreLaVisita` dentro del controlador; el permiso solo dice quién puede intentarlo.
//
// 🔴 LIMITADOR PROPIO, NO EL DEL ALTA. Los limitadores se comparten por opciones idénticas
// (`limitersCache`), así que usar `createReportLimiter` metería las anulaciones en el MISMO cupo
// que los reportes y cada anulación robaría sitio a un reporte. El mensaje distinto es lo que
// crea una instancia aparte.
// Anular es raro (4 casos en todo el histórico), pero el cupo se mide igual contra un día entero
// que se vacía de golpe: 60/hora deja sitio de sobra sin ser una puerta abierta.
const annulReportLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,
    maxByIP: 20,
    maxByUser: 60,
    message: "Límite de anulaciones de reportes de no-venta alcanzado"
});

router.post('/annul',
    verifyToken,
    annulReportLimiter,
    checkPermission('create_new_sale_in_route'),
    StoreNoSaleReportsController.annulNoSaleReport
);

module.exports = router;
