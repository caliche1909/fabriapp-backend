const express = require('express');
const { supplies_stockController } = require('../controllers');
const {verifyToken, verifyAdmin, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplies_stock/
router.post('/registerMovement', verifyToken, verifyAdmin, supplies_stockController.insertSuppliesStock); // Crear un nuevo stock de insumos

module.exports = router;