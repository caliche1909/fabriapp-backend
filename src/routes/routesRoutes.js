const express = require('express');
const {routesController} = require('../controllers');
const {verifyToken, verifyAdmin, verifySeller, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/routes/
router.get('/list', verifyToken, verifySeller, routesController.getListRoutes); // obtener todas las rutas
router.post('/create', verifyToken, verifySeller, routesController.createRoute); // crear una ruta
router.put('/update/:id', verifyToken, verifyAdmin, routesController.updateRoute); // actualizar una ruta
router.delete('/delete/:id', verifyToken, verifySuperAdmin, routesController.deleteRoute); // eliminar una ruta

module.exports = router;