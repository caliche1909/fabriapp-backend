const express = require('express');
const { register_company_and_userController } = require('../controllers');

const router = express.Router();

// api/register-company-and-user/

router.post('/', register_company_and_userController.registerCompanyAndUser);

module.exports = router;


