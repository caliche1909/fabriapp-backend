const express = require('express');
const {inventory_supplies_balanceController} = require('../controllers');
const {verifyToken, verifyAdmin, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/inventory_supplies_balance/

router.get('/list', verifyToken, verifyAdmin, inventory_supplies_balanceController.getListInventorySuppliesBalance); // obtener el balance de todos los insumos

module.exports = router;