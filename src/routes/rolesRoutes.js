const express = require('express');
const router = express.Router();
const rolesController = require('../controllers/roles_controller');
const jwtMiddleware = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA ROLES
const {
    createSmartRateLimit
} = require('../middlewares/smartRateLimit.middleware');

//api/roles/
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA CONSULTAS DE ROLES
// Se consulta para cargar en Redux cuando se va a crear usuarios
const rolesQueryLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 20,                     // 20 por IP (fallback)
    maxByUser: 50,                   // 50 consultas por usuario (generoso para catálogo)
    message: "Límite de consultas de roles alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true,    // Solo contar consultas fallidas (es catálogo)
    enableOwnerBonus: true           // OWNERS crean más usuarios → consultan más roles
});

const rolesQueryLimiterToCreate = createSmartRateLimit({
    windowMs: 10 * 60 * 1000,        // 15 minutos
    maxByIP: 10,                     // 10 por IP (fallback)
    maxByUser: 10,                   // 10 consultas por usuario (generoso para catálogo)
    message: "Límite de consultas de roles alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true,    // Solo contar consultas fallidas (es catálogo)
    enableOwnerBonus: true           // OWNERS crean más usuarios → consultan más roles
});

/**
 * @route GET /api/roles/company/:companyId
 * @desc Obtener roles disponibles para una empresa específica
 * @access Private
 */
// 👤 OBTENER ROLES PARA EMPRESA - Límite generoso (se guarda en Redux)
// Para crear usuarios colaboradores - incluye roles globales + personalizados
router.get('/company/:companyId',
    verifyToken,
    rolesQueryLimiter,               // 50 consultas/15min (se cachea en Redux)
    rolesController.getRolesByCompany
);

/**
 * @route POST /api/roles/company/:companyId
 * @desc Crear un nuevo rol personalizado para una empresa
 * @access Private
 */
router.post('/create/company/:companyId',
    verifyToken,
    checkPermission('create_rol'),
    rolesQueryLimiterToCreate,  // 10 consultas/10min
    rolesController.createCompanyRole
);

/**
 * @route GET /api/roles/:roleId/permissions
 * @desc Obtener permisos de un rol específico
 * @access Private
 */
router.get('/:roleId/permissions',
    verifyToken,
    rolesQueryLimiter,               // 50 consultas/15min
    rolesController.getRolePermissions
);

/**
 * @route PUT /api/roles/:roleId
 * @desc Actualizar un rol personalizado y sus permisos
 * @access Private
 */
router.put('/:roleId',
    verifyToken,
    checkPermission('update_rol'),   // Permisos para actualizar un rol
    rolesQueryLimiterToCreate,       // 10 consultas/10min
    rolesController.updateCompanyRole
);

/**
 * @route DELETE /api/roles/:roleId
 * @desc Eliminar un rol personalizado
 * @access Private
 */
router.delete('/:roleId',
    verifyToken,
    checkPermission('delete_rol'),   // Permisos para eliminar un rol
    rolesController.deleteCompanyRole
);









/**
 * @route GET /api/roles/company/:companyId/for-user-creation
 * @desc Obtener roles para creación de usuarios (excluye SUPER_ADMIN).
 *       La compañía se toma de la sesión (`req.user.companyId`); el `:companyId`
 *       del path se ignora (se conserva por compatibilidad con el frontend).
 * @access Private (requiere token)
 */
router.get('/company/:companyId/for-user-creation',
    verifyToken,
    rolesQueryLimiter,               // 50 consultas/15min (se cachea en Redux)
    rolesController.getRolesForUserCreation
);

module.exports = router; 