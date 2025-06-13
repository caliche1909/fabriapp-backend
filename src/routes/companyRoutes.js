const express = require('express');
const {companyController} = require('../controllers');
const {verifyToken, checkPermission} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/company/

router.put('/update_is_default_true/:id', 
    verifyToken, 
    checkPermission('edit_company_settings'), 
    companyController.updateIsDefaultTrue
);

module.exports = router;