const express = require('express');
const router = express.Router();
const StoreNoSaleReportsController = require('../controllers/store_no_sale_reports_controller');
const { verifyToken } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING
const {
    createGeneralLimiter,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

// 📌 RUTAS PARA REPORTES DE NO-VENTA

// 🛡️ Rate limiter personalizado para creación de reportes (prevenir spam)
const createReportLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 15,               // 15 reportes por hora por IP
    maxByUser: 25,             // 25 reportes por hora por usuario
    message: "Límite de creación de reportes de no-venta alcanzado"
});

// POST /api/store-no-sale-reports - Crear un nuevo reporte de no-venta
router.post('/', 
    verifyToken,
    createReportLimiter,
    StoreNoSaleReportsController.createNoSaleReport
);

// GET /api/store-no-sale-reports/company/:companyId - Obtener reportes por compañía
router.get('/company/:companyId', 
    verifyToken,
    createQueryLimiter(),
    StoreNoSaleReportsController.getReportsByCompany
);

// GET /api/store-no-sale-reports/user/:userId - Obtener reportes por usuario
router.get('/user/:userId', 
    verifyToken,
    createQueryLimiter(),
    StoreNoSaleReportsController.getReportsByUser
);

// GET /api/store-no-sale-reports/stats/company/:companyId - Obtener estadísticas por compañía
router.get('/stats/company/:companyId', 
    verifyToken,
    createQueryLimiter(),
    StoreNoSaleReportsController.getStatsByCategory
);

// GET /api/store-no-sale-reports/:reportId - Obtener un reporte específico
router.get('/:reportId', 
    verifyToken,
    createQueryLimiter(),
    StoreNoSaleReportsController.getReportById
);

// PUT /api/store-no-sale-reports/:reportId - Actualizar un reporte
router.put('/:reportId', 
    verifyToken,
    createGeneralLimiter(),
    StoreNoSaleReportsController.updateReport
);

// DELETE /api/store-no-sale-reports/:reportId - Eliminar un reporte
router.delete('/:reportId', 
    verifyToken,
    createGeneralLimiter(),
    StoreNoSaleReportsController.deleteReport
);

module.exports = router;