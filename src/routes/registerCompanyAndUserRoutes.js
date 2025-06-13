const express = require('express');
const { register_company_and_userController } = require('../controllers');
const {verifyToken, checkPermissions} = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/register-company-and-user/

// Ruta pública para el registro inicial
router.post('/initial-setup', 
    register_company_and_userController.registerCompanyAndUser
);

// Ruta protegida para registrar compañías y usuarios adicionales
router.post('/register', 
    verifyToken,
    checkPermissions(['create_company_settings', 'create_user_settings']),
    register_company_and_userController.registerCompanyAndUser
);

module.exports = router;


