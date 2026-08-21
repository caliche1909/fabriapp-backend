const express = require('express');
const { warehousesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA BODEGAS
const { createQueryLimiter, createSmartRateLimit } = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const listWarehousesLimiter = createQueryLimiter({ trustedIPs: [] });

const createWarehouseLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,
    maxByIP: 20,
    maxByUser: 60,
    message: 'Límite de creación de bodegas alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

const updateWarehouseLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 30,
    maxByUser: 80,
    message: 'Límite de actualizaciones de bodegas alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

const deleteWarehouseLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,
    maxByIP: 20,
    maxByUser: 40,
    message: 'Límite de eliminación de bodegas alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

/**
 * PERMISOS (submódulo Bodegas): el LISTADO NO se gatea con checkPermission a propósito.
 * El alcance se decide en el controlador:
 *   - owner o `view_warehouses` → todas; sin permiso → solo las bodegas asignadas al usuario.
 * Así un colaborador sin "ver todas" igual puede ver SUS bodegas (si tuviera checkPermission,
 * recibiría 403 y no vería ni las propias). La compañía SIEMPRE se toma de la sesión.
 * Las escrituras (crear/editar/eliminar) sí irán gateadas cuando se implemente el CRUD.
 */

// api/warehouses/

// 📋 LISTA DE BODEGAS (según alcance del usuario)
router.get('/list',
    verifyToken,
    listWarehousesLimiter,
    warehousesController.getWarehouses
);

// ➕ CREAR BODEGA (móvil / punto de venta)
router.post('/create',
    verifyToken,
    createWarehouseLimiter,
    checkPermission('create_warehouses'),
    warehousesController.createWarehouse
);

// ✏️ ACTUALIZAR BODEGA (la central solo permite cambiar responsable)
router.put('/update/:id',
    verifyToken,
    updateWarehouseLimiter,
    checkPermission('edit_warehouses'),
    warehousesController.updateWarehouse
);

// 🔁 ABRIR / CERRAR BODEGA (acción rápida; la central no se puede cerrar)
router.patch('/:id/status',
    verifyToken,
    updateWarehouseLimiter,
    checkPermission('edit_warehouses'),
    warehousesController.toggleWarehouseStatus
);

// 🗑️ ELIMINAR BODEGA (soft-delete; la central no se elimina)
router.delete('/delete/:id',
    verifyToken,
    deleteWarehouseLimiter,
    checkPermission('delete_warehouses'),
    warehousesController.deleteWarehouse
);

module.exports = router;
