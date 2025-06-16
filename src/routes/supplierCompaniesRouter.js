const express = require('express');
const {supplierController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplier_companies/

// Crear una nueva empresa proveedora
router.post('/create', 
    verifyToken, 
    checkPermission('create_supplier'), 
    supplierController.createSupplier
);

// Obtener todas las empresas proveedoras
router.get('/list', 
    verifyToken,
    checkPermission('view_suppliers'), 
    supplierController.getAllSuppliers
);


module.exports = router;