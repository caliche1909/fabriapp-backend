const express = require('express');
const { storesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/stores/

router.post('/create/:company_id',
    verifyToken,
    checkPermission('create-store'), // permiso para crear una tienda
    storesController.createStore
);

router.put('/update/:id',
    verifyToken,
    checkPermission('update-store'), // permiso para actualizar una tienda
    storesController.updateStore
);

router.get('/getStoresByRoute/:route_id',
    verifyToken,
    checkPermission('view-stores'), // permiso para ver las tiendas 
    storesController.getStoresbyRoute
);

router.get('/orphans/:company_id',
    verifyToken,
    checkPermission('view-stores'), // permiso para ver las tiendas huérfanas
    storesController.getOrphanStores
);

router.delete('/delete/:id',
    verifyToken,
    checkPermission('delete-store'), // permiso para eliminar una tienda
    storesController.deleteStore
);

router.put('/assignStoreToRoute/:storeId',
    verifyToken,
    checkPermission('store-to-route'), // permiso para asignar una tienda a una ruta
    storesController.assignStoreToRoute
);

module.exports = router;

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. create-store -> Permite crear una tienda
    2. update-store -> Permite actualizar una tienda
    3. view-stores -> Permite ver las tiendas
    4. view-stores-orphans -> Permite ver las tiendas huérfanas
    5. delete-store -> Permite eliminar una tienda
    6. store-to-route -> Permite asignar una tienda a una ruta
*/































