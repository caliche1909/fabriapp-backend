const express = require('express');
const router = express.Router();
const StoreNoSaleReportsController = require('../controllers/store_no_sale_reports_controller');
const { verifyToken } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING
const {
    createGeneralLimiter
} = require('../middlewares/smartRateLimit.middleware');

// 📌 RUTAS PARA REPORTES DE NO-VENTA

// 🛡️ Rate limiter personalizado para creación de reportes (prevenir spam)
const createReportLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 15,               // 15 reportes por hora por IP
    maxByUser: 25,             // 25 reportes por hora por usuario
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

module.exports = router;
