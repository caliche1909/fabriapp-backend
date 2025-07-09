const express = require('express');
const { register_company_and_userController } = require('../controllers');
const { verifyToken, checkPermissions } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA REGISTRO DE EMPRESAS
const {
    createCompanyRegistrationLimiter   
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ CONFIGURAR LIMITADORES MUY ESTRICTOS PARA REGISTRO DE EMPRESAS
const companyRegistrationLimiter = createCompanyRegistrationLimiter({
    trustedIPs: [], // IPs de tu equipo administrativo
    // Límites muy estrictos: 2 empresas por día por IP
    maxByIP: 2,
    maxByUser: 2,
    windowMs: 24 * 60 * 60 * 1000, // 24 horas
    message: "Límite diario de registro de empresas alcanzado. Contacte soporte si necesita registrar más empresas."
});


// api/register-company-and-user/

// 🔥 ENDPOINT PÚBLICO CRÍTICO - Rate limiting MUY ESTRICTO
// Este es el endpoint más vulnerable a abuso
router.post('/initial-setup',
    companyRegistrationLimiter, // Aplicar ANTES que el controlador
    register_company_and_userController.registerCompanyAndUser
);

// 🔄 ENDPOINT PROTEGIDO - Límite más generoso pero controlado
// Para administradores que crean empresas adicionales
router.post('/register',
    verifyToken,                  // Primero verificar token
    companyRegistrationLimiter,              // Límite más generoso para usuarios autenticados
    checkPermissions(['create_company_settings', 'create_user_settings']),
    register_company_and_userController.registerCompanyAndUser
);

module.exports = router;


