const express = require('express');
const { stockTransfersController } = require('../controllers');
const { verifyToken } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA TRASPASOS
const { createQueryLimiter, createSmartRateLimit } = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const listTransfersLimiter = createQueryLimiter({ trustedIPs: [] });

const createTransferLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 40,
    maxByUser: 120,
    message: 'Límite de creación de traspasos alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

const receiveTransferLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 40,
    maxByUser: 120,
    message: 'Límite de recepción de traspasos alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true,
});

/**
 * PERMISOS (submódulo Traspasos): NI el listado NI el crear se gatean con checkPermission en la ruta.
 * El alcance/autorización se decide en el CONTROLADOR (necesita datos de la bodega):
 *   - LISTA: owner o `view_transfers` → todos; sin permiso → solo los propios/involucrados.
 *   - EMITIR: owner o `create_transfer` → desde cualquier bodega; sin permiso → SOLO si es el
 *     ENCARGADO (responsable) de la bodega de ORIGEN. (Si se gateara con checkPermission, el
 *     encargado sin el permiso recibiría 403 y no podría emitir desde su propia bodega.)
 * La compañía SIEMPRE se toma de la sesión.
 */

// api/stock_transfers/

// 📋 LISTA DE TRASPASOS (según alcance del usuario)
router.get('/list',
    verifyToken,
    listTransfersLimiter,
    stockTransfersController.getTransfers
);

// ➕ EMITIR TRASPASO (2 pasos: sale del origen y queda en tránsito). Autorización en el controlador.
router.post('/create',
    verifyToken,
    createTransferLimiter,
    stockTransfersController.createTransfer
);

// 🔎 DETALLE de un traspaso (cabecera + ítems). Alcance en el controlador.
// Va DESPUÉS de '/list' y '/create' para no capturar esas rutas como :id.
router.get('/:id',
    verifyToken,
    listTransfersLimiter,
    stockTransfersController.getTransferById
);

// 📥 RECIBIR TRASPASO (paso 2: entra al destino y cierra el ciclo). Autorización en el controlador
// (3 niveles: owner / `receive_transfer` / encargado del DESTINO), por eso NO lleva checkPermission.
router.post('/:id/receive',
    verifyToken,
    receiveTransferLimiter,
    stockTransfersController.receiveTransfer
);

// ✅ MARCAR NOVEDAD COMO CUADRADA. Autorización en el controlador (3 niveles: owner /
// `resolve_transfer_discrepancy` / responsable de origen o destino), por eso NO lleva checkPermission.
router.patch('/:id/resolve',
    verifyToken,
    receiveTransferLimiter,
    stockTransfersController.resolveDiscrepancy
);

module.exports = router;
