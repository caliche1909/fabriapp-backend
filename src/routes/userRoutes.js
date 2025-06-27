const express = require('express');
const {userController} = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/users/

router.post('/login', userController.login); // Iniciar sesión
router.put('/update-user/:id', userController.update); // Actualizar usuario
router.put('/password-update/:id', userController.updatePassword); // Actualizar contraseña de usuario






router.post('/logout', verifyToken, userController.logout); // Cerrar sesión
router.post('/register', userController.register); // Registrar usuario
router.get('/stats', verifyToken, userController.getUserStats); // Estadísticas de usuarios
router.put('/set-default-company/:companyId', verifyToken, userController.setDefaultCompany); // Cambiar empresa por defecto
router.put('/switch-active-company/:companyId', verifyToken, userController.switchActiveCompany); // Cambiar empresa activa
router.get('/list', verifyToken, userController.list); // Obtener todos los usuarios
router.get('/getSellers/:company_id', verifyToken, userController.getSellers); // Obtener vendedores de una compañía específica
router.get('/:id', userController.getById); // Obtener usuario por ID
router.post('/', userController.create); // Crear usuario

router.delete('/:id', userController.delete); // Eliminar usuario

module.exports = router;

