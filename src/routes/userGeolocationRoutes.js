const express = require('express');
const router = express.Router();
const userGeolocationController = require('../controllers/user_geolocation_controller');
const jwtMiddleware = require('../middlewares/jwt.middleware');

// Middleware JWT para todas las rutas
router.use(jwtMiddleware.verifyToken);

/**
 * @route   PUT /api/users/:userId/geolocation/enable
 * @desc    Activar geolocalización para un usuario
 * @access  Private
 */
router.put('/:userId/enable', userGeolocationController.enableUserGeolocation);

/**
 * @route   PUT /api/users/:userId/geolocation/disable
 * @desc    Desactivar geolocalización para un usuario
 * @access  Private
 */
router.put('/:userId/disable', userGeolocationController.disableUserGeolocation);

/**
 * @route   PUT /api/users/:userId/geolocation/position
 * @desc    Actualizar posición de un usuario
 * @access  Private
 * @body    { latitude: number, longitude: number, accuracy?: number, source?: string }
 */
router.put('/:userId/position', userGeolocationController.updateUserPosition);

/**
 * @route   GET /api/users/:userId/geolocation/position
 * @desc    Obtener posición actual de un usuario
 * @access  Private
 */
router.get('/:userId/position', userGeolocationController.getUserPosition);

/**
 * @route   GET /api/companies/:companyId/geolocation/positions
 * @desc    Obtener todas las posiciones activas de una empresa
 * @access  Private
 */
router.get('/companies/:companyId/positions', userGeolocationController.getCompanyActivePositions);

/**
 * @route   GET /api/geolocation/nearby/:latitude/:longitude
 * @desc    Buscar usuarios cerca de una ubicación
 * @access  Private
 * @query   { radius?: number, companyId?: string }
 */
router.get('/nearby/:latitude/:longitude', userGeolocationController.findNearbyUsers);

/**
 * @route   GET /api/companies/:companyId/geolocation/stats
 * @desc    Obtener estadísticas de geolocalización de una empresa
 * @access  Private
 */
router.get('/companies/:companyId/stats', userGeolocationController.getGeolocationStats);

module.exports = router; 