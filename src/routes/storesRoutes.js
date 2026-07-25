const express = require('express');
const { storesController } = require('../controllers');
const { verifyToken, checkPermission, checkAnyPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA TIENDAS
const {
    createStoreCreationLimiter,
    createGeneralLimiter,
    createQueryLimiter,
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const deleteStoreLimiter = createGeneralLimiter({
    windowMs: 60 * 60 * 1000, // 1 hora
    maxByIP: 10,
    maxByUser: 60,
    trustedIPs: []
});

// api/stores/

router.post('/create/:company_id',
    verifyToken,
    createStoreCreationLimiter(),
    checkAnyPermission(['create_store', 'create_store_in_route']), // permiso para crear una tienda
    storesController.createStore
);

router.put('/update/:id',
    verifyToken,
    createGeneralLimiter(),
    checkPermission('update_store'), // permiso para actualizar una tienda
    storesController.updateStore
);

router.get('/getStoresByRoute/:route_id',
    verifyToken,
    createQueryLimiter(),
    checkPermission('view_stores_in_route'), // permiso para ver las tiendas 
    storesController.getStoresbyRoute
);

// 📌 Todas las tiendas de la compañía (con o sin ruta) — para "Gestión de tiendas".
router.get('/company/:company_id',
    verifyToken,
    createQueryLimiter(),
    checkPermission('view_stores'),
    storesController.getAllStores
);

router.delete('/delete/:id',
    verifyToken,
    deleteStoreLimiter,
    checkPermission('delete_store'), // permiso para eliminar una tienda
    storesController.deleteStore
);

router.put('/assignStoreToRoute/:storeId',
    verifyToken,
    createGeneralLimiter(),
    checkAnyPermission(['store_to_route', 'change_store_route']), // permiso para asignar una tienda a una ruta
    storesController.assignStoreToRoute
);

// 📌 Desvincular una tienda de UNA ruta (M2M): elimina el vínculo en routes_stores.
router.delete('/:storeId/routes/:routeId',
    verifyToken,
    createGeneralLimiter(),
    checkAnyPermission(['store_to_route', 'change_store_route']),
    storesController.removeStoreFromRoute
);

// 📌 Ruta para actualizar el estado de visita de una tienda
router.put('/update-store-as-visited/:store_id',
    verifyToken,
    createGeneralLimiter(),
    storesController.updateStoreAsVisited
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































