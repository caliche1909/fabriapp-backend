const express = require('express');
const { routesController } = require('../controllers');
const { verifyToken, checkPermission, checkAnyPermission } = require('../middlewares/jwt.middleware');
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
    1. view-routes-by-company -> Permite ver todas las rutas por compañía
    2. create-route-by-company -> Permite crear una ruta de una compañia
    3. update-route-by-company -> Permite actualizar una ruta de una compañia
    4. delete-route-by-company -> Permite eliminar una ruta de una compañia
    5. view-assigned-routes -> Permite ver las rutas asignadas al usuario
*/

router.get('/list/:company_id',
    verifyToken,
    listRoutesByCompanyLimiter, // 🔒 40 consultas/15min (se guarda en Redux)
    checkAnyPermission(['view_routes_by_company', 'view_assigned_routes']), // permiso en la base de datos para ver las rutas por compañía
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

// 🚀 Iniciar ruta: crea las visitas en 'pending' SIEMPRE a nombre del vendedor asignado a
// la ruta (`routes.user_id`). La autorización fina se valida en el controlador (no como
// middleware, porque un vendedor puede iniciar SU propia ruta sin permiso especial):
//   - La propia → ser el vendedor asignado y que el día elegido sea hábil.
//   - La de otro vendedor → owner o permiso 'start_route_for_others' (el owner además
//     puede hacerlo en días no hábiles; el permiso, no).
//   - Ruta sin vendedor asignado → nadie puede iniciarla.
router.post('/:route_id/start',
    verifyToken,
    updateRouteLimiter,
    routesController.startRoute
);

// 📋 Visitas del día de una ruta (drawer de "Iniciar ruta").
router.get('/:route_id/visits/today',
    verifyToken,
    listRoutesByCompanyLimiter,
    routesController.getRouteDayVisits
);

// 🧭 Recorrido óptimo del día (vecino más cercano + 2-opt, línea recta) desde el GPS.
// Solo ordena/clasifica las visitas pendientes; no modifica datos.
router.get('/:route_id/optimize',
    verifyToken,
    listRoutesByCompanyLimiter,
    routesController.optimizeRoute
);

// 🔎 Diagnóstico de ajustes: qué tiendas de la ruta no tienen parada en una jornada abierta
// (hoy .. hoy+30) y qué paradas quedaron huérfanas. Solo lectura.
router.get('/:route_id/adjustments',
    verifyToken,
    listRoutesByCompanyLimiter,
    routesController.getRouteAdjustments
);

// 🛠️ Aplica el ajuste que el usuario aprobó en el diálogo (agregar/quitar paradas puntuales).
// La autorización fina se valida por jornada dentro del controlador (owner, dueño de la
// jornada o `start_route_for_others`), igual que en "iniciar ruta".
router.post('/:route_id/adjustments',
    verifyToken,
    updateRouteLimiter,
    routesController.applyRouteAdjustments
);

module.exports = router;

