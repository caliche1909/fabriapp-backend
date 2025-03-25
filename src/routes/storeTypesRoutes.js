const express = require('express');
const {store_typesController} = require('../controllers');
const {verifyToken, verifyAdmin} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/store_types/
router.get('/list', verifyToken, verifyAdmin, store_typesController.getStoreTypes); // obtener todos los tipos de tiendas

module.exports = router;