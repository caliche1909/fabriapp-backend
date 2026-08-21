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

// 🛡️ LIMITADOR MÁS ESTRICTO PARA EL CAMBIO MANUAL CON CONTRASEÑA (protege contra fuerza bruta)
const switchDefaultCompanyLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 20,                     // 20 intentos por IP
    maxByUser: 10,                   // 10 intentos por usuario cada 15 minutos
    message: "Demasiados intentos de cambio de compañía. Intente más tarde.",
    trustedIPs: [],
    enableOwnerBonus: false
});

// api/company/

// 🔄 ESTABLECER MI COMPAÑÍA POR DEFECTO (auto-set) — acción PERSONAL del usuario.
// Sin checkPermission: elegir cuál de MIS compañías es la predeterminada no es gestión de
// settings de la empresa. La autorización real la da la validación de MEMBRESÍA en el
// controlador (403 si no perteneces). Consistente con /switch-default.
router.put('/update_is_default_true/:id',
    verifyToken,                     // Verificar autenticación
    changeDefaultCompanyLimiter,     // Rate limiting específico (30 peticiones/15min por usuario)
    companyController.updateIsDefaultTrue
);

// 📝 ACTUALIZAR DATOS DE UNA COMPAÑÍA
router.put('/update/:id',
    verifyToken,                     // Verificar autenticación
    checkPermission('update_company_settings'), // Verificar permisos
    companyController.updateCompanyById
);

// 🔐 CAMBIO MANUAL DE COMPAÑÍA POR DEFECTO (requiere contraseña) - acción personal del usuario.
// Sin checkPermission: cualquier miembro puede cambiar su propia compañía por defecto; la
// autorización real la dan la contraseña + la validación de membresía en el controlador.
router.put('/switch-default/:id',
    verifyToken,                     // Verificar autenticación
    switchDefaultCompanyLimiter,     // Rate limiting estricto (anti fuerza bruta)
    companyController.switchDefaultCompany
);

module.exports = router;