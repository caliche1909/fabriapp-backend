const express = require('express');
const { inventory_suppliesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplies/

// Obtener todos los insumos de una compañía
router.get('/list/:company_id',
    verifyToken,
    checkPermission('view_supplies'),
    inventory_suppliesController.getListOfInventorySupplies
);

// Crear nuevo insumo
router.post('/create',
    verifyToken,
    checkPermission('create_supplies'),
    inventory_suppliesController.createInventorySupply
);

// Actualizar un insumo por id
router.put('/update/:id',
    verifyToken,
    checkPermission('edit_supplies'),
    inventory_suppliesController.updateInventorySupply
);

// Eliminar un insumo por id
router.delete('/delete/:id',
    verifyToken,
    checkPermission('delete_supplies'),
    inventory_suppliesController.deleteInventorySupply
);

// Obtener un insumo por id
router.get('/get-supply-by-id/:id',
    verifyToken,
    checkPermission('view_supplies'),
    inventory_suppliesController.getInventorySupplyById
);

module.exports = router;