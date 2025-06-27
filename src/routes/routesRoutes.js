const express = require('express');
const {routesController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/routes/
router.get('/list/:company_id', 
    verifyToken, 
    checkPermission('view-routes-by-company'), // permiso en la base de datos para ver las rutas por compañía
    routesController.getListRoutes
);

router.post('/create/:company_id', 
    verifyToken, 
    checkPermission('create-route-by-company'), // permiso en la base de datos para crear una ruta de una compañia
    routesController.createRoute
);

router.put('/update/:id', 
    verifyToken, 
    checkPermission('update-route-by-company'), // permiso en la base de datos para actualizar una ruta de una compañia
    routesController.updateRoute
);

router.delete('/delete/:id', 
    verifyToken, 
    checkPermission('delete-route-by-company'), // permiso en la base de datos para eliminar una ruta de una compañia
    routesController.deleteRoute
);

module.exports = router;

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. view-routes-by-company -> Permite ver las rutas por compañía
    2. create-route-by-company -> Permite crear una ruta de una compañia
    3. update-route-by-company -> Permite actualizar una ruta de una compañia
    4. delete-route-by-company -> Permite eliminar una ruta de una compañia
*/