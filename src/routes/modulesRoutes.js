const express = require('express');
const router = express.Router();
const modulesController = require('../controllers/modules_controller');

// 🛡️ IMPORTAR RATE LIMITING Y MIDDLEWARES
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA CONSULTAS DE MÓDULOS
// Se consulta para cargar en UserPermissions.tsx cuando se crean roles
const modulesQueryLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 10,                     // 10 por IP (fallback)
    maxByUser: 20,                   // 20 consultas por usuario (generoso para catálogo)
    message: "Límite de consultas de módulos alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true,    // Solo contar consultas fallidas (es catálogo)
    enableOwnerBonus: false          // No necesario para módulos
});

/**
 * @route GET /api/modules
 * @desc Obtener todos los módulos con sus submódulos y permisos
 * @access Private
 */
router.get('/',
    verifyToken,
    checkPermission('view_company_settings'),
    modulesQueryLimiter,             // 20 consultas/15min (se cachea en componente)
    modulesController.getModulesWithPermissions
);

module.exports = router; 