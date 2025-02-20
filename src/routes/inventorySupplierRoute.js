const express = require('express');
const {inventory_suppliesController} = require('../controllers');
const {verifyToken, verifyAdmin, verifySuperAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/inventory_supplies/

router.post('/create', verifyToken, verifyAdmin, inventory_suppliesController.createInventorySupply); // crear nuevo insumo
router.get('/list', verifyToken, verifyAdmin, inventory_suppliesController.getAllInventorySupplies); // obtener todos los insumos
router.put('/update/:id', verifyToken, verifyAdmin, inventory_suppliesController.updateInventorySupply); // actualizar un insumo por id

module.exports = router;