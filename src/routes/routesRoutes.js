const express = require('express');
const {routesController} = require('../controllers');
const {verifyToken, verifyAdmin, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/routes/
router.get('/list', verifyToken, verifyAdmin, routesController.getListRoutes); // obtener todas las rutas
router.post('/create', verifyToken, verifyAdmin, routesController.createRoute); // crear una ruta

module.exports = router;