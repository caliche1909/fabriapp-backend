const express = require('express');
const {userController} = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

const router = express.Router();

// api/users/

router.post('/login', userController.login); // Iniciar sesión
router.post('/register', userController.register); // Registrar usuario
router.get('/list', verifyToken, userController.list); // Obtener todos los usuarios
router.get('/getSellers/:company_id', verifyToken, userController.getSellers); // Obtener vendedores de una compañía específica
router.get('/:id', userController.getById); // Obtener usuario por ID
router.post('/', userController.create); // Crear usuario
router.put('/:id', userController.update); // Actualizar usuario
router.delete('/:id', userController.delete); // Eliminar usuario



module.exports = router;

