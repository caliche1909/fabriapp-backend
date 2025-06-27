const express = require('express');
const { inventory_suppliesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

const router = express.Router();

/**
 * PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
 * 
 * 1. view_supplies -> Permite ver los insumos
 * 2. create-supply -> Permite crear un insumo
 * 3. update-supply -> Permite actualizar un insumo
 * 4. delete-supply -> Permite eliminar un insumo 
 */



// api/supplies/

// Obtener todos los insumos de una compañía
router.get('/list/:company_id',
    verifyToken,
    checkPermission('view_supplies'), // permiso en la base de datos para ver los insumos
    inventory_suppliesController.getListOfInventorySupplies
);

// Crear nuevo insumo
router.post('/create',
    verifyToken,
    checkPermission('create-supply'), // permiso en la base de datos para crear un insumo
    inventory_suppliesController.createInventorySupply
);

// Actualizar un insumo por id
router.put('/update/:id',
    verifyToken,
    checkPermission('update-supply'), // permiso en la base de datos para actualizar un insumo
    inventory_suppliesController.updateInventorySupply
);

// Eliminar un insumo por id
router.delete('/delete/:id',
    verifyToken,
    checkPermission('delete-supply'), // permiso en la base de datos para eliminar un insumo
    inventory_suppliesController.deleteInventorySupply
);

// Obtener un insumo por id
router.get('/get-supply-by-id/:id',
    verifyToken,
    checkPermission('view_supplies'), // permiso en la base de datos para ver un insumo
    inventory_suppliesController.getInventorySupplyById
);

module.exports = router;