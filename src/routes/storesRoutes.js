const express = require('express');
const {storesController} = require('../controllers');
const {verifyToken, verifySeller} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/stores/

router.post('/create', verifyToken, verifySeller, storesController.createStore); // crear una tienda

module.exports = router;
