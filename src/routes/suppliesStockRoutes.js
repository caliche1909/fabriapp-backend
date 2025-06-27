const express = require('express');
const { supplies_stockController } = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplies_stock/
router.post('/registerMovement', 
    verifyToken, 
    checkPermission('update-supplies-stock'), // permiso en la base de datos para actualizar el stock de un insumo con un movimiento
    supplies_stockController.insertSuppliesStock
);

router.get('/movements/:supplyId', 
    verifyToken, 
    checkPermission('view-movements-supplies-stock'), // permiso en la base de datos para ver los movimientos de stock de un insumo
    supplies_stockController.getSuppliesStockBySupplyId
);

module.exports = router;

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. update-supplies-stock -> Permite actualizar el stock de un insumo con un movimiento
    2. view-movements-supplies-stock -> Permite ver los movimientos de stock de un insumo
*/