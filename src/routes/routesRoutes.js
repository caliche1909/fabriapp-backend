const express = require('express');
const { routesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');
const {
    createListRoutesByCompanyLimiter,
    createCreateRouteLimiter,
    createUpdateRouteLimiter,
    createDeleteRouteLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/routes/

// 🛡️ CONFIGURAR LIMITADORES ESPECÍFICOS PARA RUTAS
const listRoutesByCompanyLimiter = createListRoutesByCompanyLimiter();
const createRouteLimiter = createCreateRouteLimiter();
const updateRouteLimiter = createUpdateRouteLimiter();
const deleteRouteLimiter = createDeleteRouteLimiter();

/*
    PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
    1. view-routes-by-company -> Permite ver las rutas por compañía
    2. create-route-by-company -> Permite crear una ruta de una compañia
    3. update-route-by-company -> Permite actualizar una ruta de una compañia
    4. delete-route-by-company -> Permite eliminar una ruta de una compañia
*/

router.get('/list/:company_id',
    verifyToken,
    listRoutesByCompanyLimiter, // 🔒 40 consultas/15min (se guarda en Redux)
    checkPermission('view_routes_by_company'), // permiso en la base de datos para ver las rutas por compañía
    routesController.getListRoutes
);

router.post('/create/:company_id',
    verifyToken,
    createRouteLimiter, // 🔒 10 rutas/hora (operación deliberada de configuración)
    checkPermission('create_route_by_company'), // permiso en la base de datos para ver las rutas por compañía
    routesController.createRoute
);

router.put('/update/:id',
    verifyToken,
    updateRouteLimiter, // 🔒 30 actualizaciones/15min (ajustes de rutas existentes)
    checkPermission('update_route_by_company'),
    routesController.updateRoute
);

router.delete('/delete/:id',
    verifyToken,
    deleteRouteLimiter, // 🔒 5 eliminaciones/hora (operación crítica, afecta logística)
    checkPermission('delete_route_by_company'),
    routesController.deleteRoute
);

module.exports = router;

