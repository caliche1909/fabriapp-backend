const express = require('express');
const router = express.Router();
const routeTypesController = require('../controllers/route_types_controller');
const { verifyToken } = require('../middlewares/jwt.middleware');

// 📌 Obtener tipos de rutas de una compañía (globales + específicos)
router.get('/list/:company_id', verifyToken, routeTypesController.getRouteTypesByCompany);

module.exports = router;
