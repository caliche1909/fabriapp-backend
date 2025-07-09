const express = require('express');
const { userController } = require('../controllers');
const { verifyToken, checkPermission, checkAnyPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING INTELIGENTE
const {
    createLoginLimiter,
    createUserCreationLimiter,
    createGeneralLimiter,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ LIMITADORES PERSONALIZADOS PARA USUARIOS
// Login - Muy restrictivo (crítico de seguridad)
const loginLimiter = createLoginLimiter({
    trustedIPs: [], // IPs administrativas
    message: "Demasiados intentos de login. Intente más tarde"
});

// Crear usuario - Moderado (operación de configuración)  
const userCreationLimiter = createUserCreationLimiter({
    windowMs: 60 * 60 * 1000,      // 1 hora
    maxByIP: 8,                    // 8 usuarios por hora por IP
    maxByUser: 20,                 // 20 usuarios por hora por usuario
    message: "Límite de creación de usuarios alcanzado",
    enableOwnerBonus: true         // OWNERS: 30 usuarios/hora
});

// Actualizar datos usuario - Generoso (operación común)
const updateUserLimiter = createGeneralLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos  
    maxByIP: 40,                   // 40 actualizaciones por IP
    maxByUser: 50,                // 100 actualizaciones por usuario
    message: "Límite de actualización de usuarios alcanzado",
    enableOwnerBonus: true         // OWNERS: 150 actualizaciones/15min
});

// Actualizar contraseña - Más restrictivo (operación sensible)
const updatePasswordLimiter = createGeneralLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 10,                   // 10 cambios por IP
    maxByUser: 15,                 // 25 cambios por usuario
    message: "Límite de cambio de contraseñas alcanzado",
    enableOwnerBonus: true,        // OWNERS: 37 cambios/15min
    skipSuccessfulRequests: false  // Contar todos los cambios (auditoría)
});

// Consultar vendedores - Moderado (para formularios/selects)
const getSellersLimiter = createQueryLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 30,                   // 60 consultas por IP
    maxByUser: 60,                // 180 consultas por usuario (formularios)
    message: "Límite de consulta de vendedores alcanzado",
    enableOwnerBonus: true         // OWNERS: 270 consultas/15min
});

// api/users/

// 🔥 ENDPOINTS CRÍTICOS CON RATE LIMITING ESTRICTO
router.post('/login',
    loginLimiter, // 🔒 5 intentos/15min (crítico de seguridad)
    userController.login
);

// 🔥 ENDPOINTS PROTEGIDOS CON RATE LIMITING MODERADO  
router.post('/create-user',
    verifyToken,
    checkPermission('create-user'),
    userCreationLimiter, // 🔒 20 usuarios/hora (configuración)
    userController.createUser
);

router.post('/create-existing-user',
    verifyToken,
    checkPermission('create-user'),
    userCreationLimiter, // 🔒 20 usuarios/hora (misma operación)
    userController.createExistingUser
);

// 🔄 ENDPOINTS DE ACTUALIZACIÓN CON LÍMITES ESPECÍFICOS
router.put('/update-user/:id',
    verifyToken,
    checkAnyPermission(['update-personal-user']),
    updateUserLimiter, // 🔒 100 actualizaciones/15min (operación común)
    userController.update
);

router.put('/password-update/:id',
    verifyToken,
    updatePasswordLimiter, // 🔒 25 cambios/15min (operación sensible)
    userController.updatePassword
);

// 🔍 ENDPOINTS DE CONSULTA CON LÍMITE MODERADO
router.get('/getSellers/:company_id',
    verifyToken,
    getSellersLimiter, // 🔒 180 consultas/15min (para formularios)
    userController.getSellers
);


/*permisos de usuario en la base de datos
  update-personal-user -> permiso para actualizar los datos personales de un usuario,
  create-user -> permiso para crear un usuario,
*/

/*----------------------------------------ENDPOINTS NO UTILIZADOS AÚN ----------------------------------------*/

// 🔄 OTROS ENDPOINTS CON LÍMITE GENERAL (NO ACTIVOS)
// router.post('/logout', verifyToken, generalLimiter, userController.logout);
// router.put('/set-default-company/:companyId', verifyToken, generalLimiter, userController.setDefaultCompany);
// router.put('/switch-active-company/:companyId', verifyToken, generalLimiter, userController.switchActiveCompany);
// router.get('/stats', verifyToken, queryLimiter, userController.getUserStats);

// 🔍 CONSULTAS CON LÍMITE GENEROSO (NO ACTIVAS)
// router.get('/list', verifyToken, queryLimiter, userController.list);
// router.get('/:id', queryLimiter, userController.getById);

// 🔄 ENDPOINTS LEGACY CON LÍMITE GENERAL (NO ACTIVOS)
// router.post('/', generalLimiter, userController.create);
// router.delete('/:id', generalLimiter, userController.delete);

module.exports = router;

