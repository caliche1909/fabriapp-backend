const express = require('express');
const { companySettingsController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA CONFIGURACIONES
const { createQueryLimiter, createSmartRateLimit } = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const readSettingsLimiter = createQueryLimiter({ trustedIPs: [] });

const updateSettingsLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 20,
    maxByUser: 40,
    message: 'Límite de cambios de configuración alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

/**
 * PERMISOS (submódulo `general-settings`): `view_general_settings` y `manage_general_settings`.
 * A diferencia de bodegas/traspasos, aquí SÍ se gatea en la ruta: no hay alcance parcial que
 * decidir (o ves las configuraciones de tu compañía o no). Los OWNERS bypassan checkPermission.
 * La compañía SIEMPRE se toma de la sesión.
 */

// api/company_settings/

// 📋 VER las configuraciones de la compañía
router.get('/',
    verifyToken,
    readSettingsLimiter,
    checkPermission('view_general_settings'),
    companySettingsController.getCompanySettings
);

// ✏️ GUARDAR cambios en las configuraciones
router.put('/',
    verifyToken,
    updateSettingsLimiter,
    checkPermission('manage_general_settings'),
    companySettingsController.updateCompanySettings
);

module.exports = router;
