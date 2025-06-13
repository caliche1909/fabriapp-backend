const express = require('express');
const {storesController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/stores/

router.post('/create', 
    verifyToken, 
    checkPermission('create_stores_management'), 
    storesController.createStore
);

router.get('/getStoresByRoute/:route_id', 
    verifyToken, 
    checkPermission('view_stores_management'), 
    storesController.getStoresbyRoute
);

router.get('/orphans', 
    verifyToken, 
    checkPermission('view_stores_management'), 
    storesController.getOrphanStores
);

router.delete('/delete/:id', 
    verifyToken, 
    checkPermission('delete_stores_management'), 
    storesController.deleteStore
);

router.put('/update/:id', 
    verifyToken, 
    checkPermission('edit_stores_management'), 
    storesController.updateStore
);

router.put('/assignStoreToRoute/:storeId', 
    verifyToken, 
    checkPermission('edit_stores_management'), 
    storesController.assignStoreToRoute
);

module.exports = router;
