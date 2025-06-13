const express = require('express');
const {inventory_supplies_balanceController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/inventory_supplies_balance/

router.get('/list', 
    verifyToken, 
    checkPermission('view_supplies_stock'), 
    inventory_supplies_balanceController.getListInventorySuppliesBalance
);

module.exports = router;