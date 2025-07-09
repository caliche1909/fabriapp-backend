const express = require('express');
const {supplierController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

// 🛡️ IMPORTAR RATE LIMITING EXISTENTES PARA PERSONALIZAR
const {
    createStoreCreationLimiter,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/supplier_companies/

// 🛡️ LIMITADORES PERSONALIZADOS PARA PROVEEDORES
// Crear proveedor - Basado en createStoreCreationLimiter pero más restrictivo
const createSupplierLimiter = createStoreCreationLimiter({
    windowMs: 60 * 60 * 1000,      // 1 hora
    maxByIP: 5,                    // 5 proveedores por hora por IP
    maxByUser: 30,                 // 30 proveedores por hora por usuario
    message: "Límite de creación de proveedores alcanzado",
    enableOwnerBonus: true         // OWNERS: 22 proveedores/hora
});

// Listar proveedores - Basado en createQueryLimiter pero más moderado
const listSuppliersLimiter = createQueryLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 50,                   // 50 consultas por IP
    maxByUser: 100,                // 100 consultas por usuario (para formularios)
    message: "Límite de consulta de proveedores alcanzado",
    enableOwnerBonus: true         // OWNERS: 225 consultas/15min
});

// Crear una nueva empresa proveedora
router.post('/create', 
    verifyToken, 
    createSupplierLimiter, // 🔒 15 proveedores/hora (setup para insumos)
    checkPermission('create_supplier'), 
    supplierController.createSupplier
);

// Obtener todas las empresas proveedoras
router.get('/list', 
    verifyToken,
    listSuppliersLimiter, // 🔒 150 consultas/15min (para formularios de insumos)
    checkPermission('view_suppliers'), 
    supplierController.getAllSuppliers
);

module.exports = router;