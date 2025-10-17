const express = require('express');
const { payment_methodsController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING EXISTENTES PARA PERSONALIZAR
const {
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/payment_methods/

// 🛡️ LIMITADORES PERSONALIZADOS PARA MÉTODOS DE PAGO
// Ver métodos de pago - Basado en createQueryLimiter para consultas frecuentes
const viewPaymentMethodsLimiter = createQueryLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 60,                   // 60 consultas por IP
    maxByUser: 150,                // 150 consultas por usuario (consultas frecuentes en UI)
    message: "Límite de consulta de métodos de pago alcanzado",
    enableOwnerBonus: true         // OWNERS: 225 consultas/15min
});

// 🔍 RUTA PRINCIPAL: Obtener métodos de pago por compañía
// Retorna métodos globales + específicos de la compañía
router.get('/company/:companyId',
    verifyToken,
    viewPaymentMethodsLimiter, // 🔒 150 consultas/15min (consultas frecuentes)
    //checkPermission('view_payment_methods'), 
    payment_methodsController.getPaymentMethodsByCompany
);

module.exports = router;

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. view-payment-methods -> Permite ver los métodos de pago disponibles para una compañía
*/