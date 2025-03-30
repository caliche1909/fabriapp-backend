const express = require('express');
const {storesController} = require('../controllers');
const {verifyToken, verifySeller, verifyAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/stores/

router.post('/create', verifyToken, verifySeller, storesController.createStore); // crear una tienda
router.get('/getStoresByRoute/:route_id', verifyToken, verifySeller, storesController.getStoresbyRoute); // obtener todas las tiendas de una ruta
router.get('/orphans', verifyToken, verifySeller, storesController.getOrphanStores); // obtener todas las tiendas que no tienen ruta asignada
router.delete('/delete/:id', verifyToken, verifyAdmin, storesController.deleteStore); // eliminar una tienda
router.put('/update/:id', verifyToken, verifyAdmin, storesController.updateStore); // actualizar una tienda

module.exports = router;
