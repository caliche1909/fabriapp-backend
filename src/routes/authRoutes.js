const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');

// 🛡️ CONFIGURAR LIMITADORES ESPECÍFICOS PARA AUTENTICACIÓN
const forgotPasswordLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 5,                      // 5 solicitudes por IP
    maxByUser: 3,                    // 3 solicitudes por usuario identificado por email/phone
    message: "Demasiadas solicitudes de recuperación de contraseña",
    trustedIPs: []
});

const verifyCodeLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 10,                     // 10 intentos por IP
    maxByUser: 5,                    // 5 intentos por teléfono
    message: "Demasiados intentos de verificación de código",
    trustedIPs: []
});

const resetPasswordLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 5,                      // 5 cambios por IP
    maxByUser: 3,                    // 3 cambios por usuario
    message: "Demasiados intentos de cambio de contraseña",
    trustedIPs: []
});

// api/auth/

// 📌 RUTAS DE RECUPERACIÓN DE CONTRASEÑA

// Solicitar recuperación de contraseña (email o WhatsApp)
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);

// Validar token de recuperación (solo para email)
router.get('/validate-reset-token/:token', authController.validateResetToken);

// Verificar código de recuperación (solo para WhatsApp)
//router.post('/verify-reset-code', verifyCodeLimiter, authController.verifyResetCode);

// Restablecer contraseña
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);

module.exports = router;