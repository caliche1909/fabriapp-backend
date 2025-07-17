const express = require('express');
const {store_typesController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA TIPOS DE TIENDA
const { createStoreTypesCatalogLimiter } = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/store_types/

// 🛡️ CONFIGURAR LIMITADOR ESPECÍFICO PARA CATÁLOGO DE TIPOS DE TIENDA
const storeTypesCatalogLimiter = createStoreTypesCatalogLimiter();

// Obtener todos los tipos de tiendas
router.get('/list', 
    verifyToken, 
    storeTypesCatalogLimiter, // 🔒 75 consultas/15min (se guarda en Redux)
    //checkPermission('view_stores_management'), 
    store_typesController.getStoreTypes
);

module.exports = router;