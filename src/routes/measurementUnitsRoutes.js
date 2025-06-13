const express = require('express');
const {measurement_unitsController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/measurement_units/

router.get('/', 
    verifyToken, 
    checkPermission('view_company_settings'), 
    measurement_unitsController.list
);

module.exports = router;