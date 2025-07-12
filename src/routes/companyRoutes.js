const express = require('express');
const { companyController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA OPERACIONES DE EMPRESA
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA CAMBIO DE EMPRESA POR DEFECTO
const changeDefaultCompanyLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 10,                     // 10 por IP (para casos sin autenticación)
    maxByUser: 50,                   // 30 cambios por usuario cada 15 minutos
    message: "Haz alcanzado el límite de cambios de empresa por defecto, intente más tarde",
    trustedIPs: [],                  // Agregar IPs de tu equipo administrativo si es necesario
    enableOwnerBonus: false          // Sin bonus para esta operación específica
});

// api/company/

// 🔄 CAMBIAR EMPRESA POR DEFECTO - Límite específico (30/15min)
// Operación de actualización con límite personalizado
router.put('/update_is_default_true/:id',
    verifyToken,                     // Verificar autenticación
    changeDefaultCompanyLimiter,     // Rate limiting específico (30 peticiones/15min por usuario)
    checkPermission('update_company_settings'), // Verificar permisos
    companyController.updateIsDefaultTrue
);

// 📝 ACTUALIZAR DATOS DE UNA COMPAÑÍA
router.put('/update/:id',
    verifyToken,                     // Verificar autenticación
    checkPermission('update_company_settings'), // Verificar permisos
    companyController.updateCompanyById
);

module.exports = router;