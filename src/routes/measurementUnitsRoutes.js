const express = require('express');
const { measurement_unitsController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA UNIDADES DE MEDIDA
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA CATÁLOGO DE UNIDADES DE MEDIDA
// Consulta de referencia para formularios de creación/edición de productos
const measurementUnitsLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 30,                     // 30 por IP (fallback)
    maxByUser: 100,                  // 100 consultas por usuario (generoso para catálogo)
    message: "Límite de consultas de unidades de medida alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true,    // Solo contar consultas fallidas (es catálogo de referencia)
    enableOwnerBonus: false          // Sin bonus - es información de catálogo igual para todos
});

// api/measurement_units/

// 📏 OBTENER CATÁLOGO DE UNIDADES DE MEDIDA - Límite generoso (consulta de referencia)
// Para formularios de creación/edición de productos e insumos
router.get('/',
    verifyToken,
    measurementUnitsLimiter,        
    measurement_unitsController.list
);

module.exports = router;