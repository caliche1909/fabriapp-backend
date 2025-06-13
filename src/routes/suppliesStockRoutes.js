const express = require('express');
const { supplies_stockController } = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplies_stock/
router.post('/registerMovement', 
    verifyToken, 
    checkPermission('create_supplies_stock'), 
    supplies_stockController.insertSuppliesStock
);

router.get('/movements/:supplyId', 
    verifyToken, 
    checkPermission('view_supplies_stock'), 
    supplies_stockController.getSuppliesStockBySupplyId
);

module.exports = router;