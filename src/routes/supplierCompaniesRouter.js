const express = require('express');
const {supplierController} = require('../controllers');
const {verifyToken, verifyAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/supplier_companies/

router.post('/create', verifyToken, verifyAdmin, supplierController.createSupplier); //Crear una nueva empresa proveedora
router.get('/list', verifyToken,verifyAdmin, supplierController.getAllSuppliers); //Obtener todas las empresas proveedoras

module.exports = router;