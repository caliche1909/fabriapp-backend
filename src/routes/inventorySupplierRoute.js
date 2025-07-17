const express = require('express');
const { inventory_suppliesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA INVENTARIO DE SUMINISTROS
const {
    createSmartRateLimit,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ CONFIGURAR LIMITADORES ESPECÍFICOS PARA INVENTARIO DE SUMINISTROS

// Para listar insumos - operación pesada que se guarda en Redux
const listSuppliesLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 10,                     // 10 por IP (fallback)
    maxByUser: 25,                   // 25 consultas por usuario (moderado)
    message: "Límite de consultas de inventario alcanzado",
    trustedIPs: [],
    skipSuccessfulRequests: true     // Solo contar consultas fallidas
});

// Para crear insumos - operación lenta (30-60 segundos)
const createSupplyLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,        // 1 hora
    maxByIP: 8,                      // 8 por IP (fallback)
    maxByUser: 60,                   // 60 creaciones por hora (considerando 30-60s cada una)
    message: "Límite de creación de insumos alcanzado",
    trustedIPs: [],
    enableOwnerBonus: true           // OWNERS pueden crear más
});

// Para actualizar insumos - operación rápida pero controlada
const updateSupplyLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,        // 15 minutos
    maxByIP: 20,                     // 20 por IP (fallback)
    maxByUser: 60,                   // 60 actualizaciones por 15min (operación rápida)
    message: "Límite de actualizaciones de insumos alcanzado",
    trustedIPs: [],
    enableOwnerBonus: true
});

// Para eliminar insumos - operación crítica y lenta (15-30 segundos)
const deleteSupplyLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,        // 1 hora
    maxByIP: 5,                      // 5 por IP (muy restrictivo)
    maxByUser: 15,                   // 15 eliminaciones por hora (operación crítica)
    message: "Límite de eliminaciones de insumos alcanzado",
    trustedIPs: [],
    enableOwnerBonus: true           // OWNERS pueden eliminar más
});

// Para consultas específicas de insumos - operación rápida
const querySupplyLimiter = createQueryLimiter({
    trustedIPs: []
});

/**
 * PERMISOS REGISTRADOS EN LA BASE DE DATOS PARA ESTAS RUTAS
 * 
 * 1. view_supplies -> Permite ver los insumos
 * 2. create-supply -> Permite crear un insumo
 * 3. update-supply -> Permite actualizar un insumo
 * 4. delete-supply -> Permite eliminar un insumo 
 */

// api/supplies/

// 🔍 OBTENER LISTA DE INSUMOS - Límite moderado (carga pesada, se guarda en Redux)
router.get('/list/:company_id',
    verifyToken,
    listSuppliesLimiter,             // 25 consultas/15min (operación pesada)
    checkPermission('view_supplies'), // permiso en la base de datos para ver los insumos
    inventory_suppliesController.getListOfInventorySupplies
);

// 📦 CREAR NUEVO INSUMO - Límite restrictivo (30-60 segundos por operación)
router.post('/create',
    verifyToken,
    createSupplyLimiter,             // 20 creaciones/hora (considerando tiempo de operación)
    checkPermission('create_supply'), // permiso en la base de datos para crear un insumo
    inventory_suppliesController.createInventorySupply
);

// 🔄 ACTUALIZAR INSUMO - Límite generoso (operación rápida)
router.put('/update/:id',
    verifyToken,
    updateSupplyLimiter,             // 60 actualizaciones/15min (operación rápida)
    checkPermission('update_supply'), // permiso en la base de datos para actualizar un insumo
    inventory_suppliesController.updateInventorySupply
);

// 🗑️ ELIMINAR INSUMO - Límite muy restrictivo (15-30 segundos, operación crítica)
router.delete('/delete/:id',
    verifyToken,
    deleteSupplyLimiter,             // 15 eliminaciones/hora (operación crítica y lenta)
    checkPermission('delete_supply'), // permiso en la base de datos para eliminar un insumo
    inventory_suppliesController.deleteInventorySupply
);

// 🔍 OBTENER INSUMO ESPECÍFICO - Límite generoso (consulta rápida)
router.get('/get-supply-by-id/:id',
    verifyToken,
    querySupplyLimiter,              // 500 consultas/15min (operación de lectura rápida)
    checkPermission('view_supplies'), // permiso en la base de datos para ver un insumo
    inventory_suppliesController.getInventorySupplyById
);

module.exports = router;