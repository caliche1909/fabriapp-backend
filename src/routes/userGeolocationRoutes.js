const express = require('express');
const router = express.Router();
const userGeolocationController = require('../controllers/user_geolocation_controller');
const jwtMiddleware = require('../middlewares/jwt.middleware');

// 🛡️ LIMITADORES PERSONALIZADOS PARA GEOLOCALIZACIÓN DE USUARIOS
// Nota: falta implementar los limitadores ojo!!



// Middleware JWT para todas las rutas
router.use(jwtMiddleware.verifyToken);


/**
 * @route   PUT /api/users/:userId/geolocation/position
 * @desc    Actualizar posición de un usuario
 * @access  Private
 * @body    { latitude: number, longitude: number, accuracy?: number, source?: string }
 */
router.put('/:userId/position', userGeolocationController.updateUserPosition);


module.exports = router; 