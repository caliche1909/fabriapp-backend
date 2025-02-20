const express = require('express');
const {measurement_unitsController} = require('../controllers');
const {verifyToken, verifyAdmin, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/measurement_units/

router.get('/', verifyToken, verifyAdmin, measurement_unitsController.list); // Obtener todas las unidades de medida

module.exports = router;