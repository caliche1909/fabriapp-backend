const express = require('express');
const {routesController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/routes/
router.get('/list', 
    verifyToken, 
    checkPermission('view_routes_management'), 
    routesController.getListRoutes
);

router.post('/create', 
    verifyToken, 
    checkPermission('create_routes_management'), 
    routesController.createRoute
);

router.put('/update/:id', 
    verifyToken, 
    checkPermission('edit_routes_management'), 
    routesController.updateRoute
);

router.delete('/delete/:id', 
    verifyToken, 
    checkPermission('delete_routes_management'), 
    routesController.deleteRoute
);

module.exports = router;