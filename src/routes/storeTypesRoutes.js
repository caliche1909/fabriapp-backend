const express = require('express');
const {store_typesController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/store_types/

// Obtener todos los tipos de tiendas
router.get('/list', 
    verifyToken, 
    checkPermission('view_stores_management'), 
    store_typesController.getStoreTypes
);

module.exports = router;