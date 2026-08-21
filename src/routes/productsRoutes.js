const express = require('express');
const { productsController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA EL CATÁLOGO DE PRODUCTOS
const {
    createSmartRateLimit,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🔍 Listar productos — carga que se cachea en Redux (moderado).
const listProductsLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 10,
    maxByUser: 30,
    message: 'Límite de consultas de productos alcanzado',
    trustedIPs: [],
    skipSuccessfulRequests: true
});

// ➕ Crear producto.
const createProductLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,
    maxByIP: 15,
    maxByUser: 80,
    message: 'Límite de creación de productos alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

// ✏️ Actualizar producto (operación rápida).
const updateProductLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 25,
    maxByUser: 80,
    message: 'Límite de actualizaciones de productos alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

// 🗑️ Eliminar producto (crítico).
const deleteProductLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,
    maxByIP: 8,
    maxByUser: 25,
    message: 'Límite de eliminaciones de productos alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

// 🔍 Consulta puntual (lectura rápida).
const queryProductLimiter = createQueryLimiter({ trustedIPs: [] });

/**
 * PERMISOS (submódulo `products`): view_products, create_products, edit_products, delete_products.
 * La compañía se toma SIEMPRE de la sesión (req.user.companyId), no de la URL.
 * NOTA: estos permisos existen sembrados pero inactivos; los OWNERS bypassan checkPermission
 * (funciona ya). Para colaboradores hace falta activarlos y asignarlos a sus roles (migración aparte).
 */

// api/products/

// 📋 LISTA DE PRODUCTOS (?search=&categoryId=&isActive=)
router.get('/list',
    verifyToken,
    listProductsLimiter,
    checkPermission('view_products'),
    productsController.getProducts
);

// 🔍 PRODUCTO POR ID
router.get('/detail/:id',
    verifyToken,
    queryProductLimiter,
    checkPermission('view_products'),
    productsController.getProductById
);

// ➕ CREAR PRODUCTO
router.post('/create',
    verifyToken,
    createProductLimiter,
    checkPermission('create_products'),
    productsController.createProduct
);

// ✏️ ACTUALIZAR PRODUCTO
router.put('/update/:id',
    verifyToken,
    updateProductLimiter,
    checkPermission('edit_products'),
    productsController.updateProduct
);

// 🗑️ ELIMINAR PRODUCTO (soft-delete)
router.delete('/delete/:id',
    verifyToken,
    deleteProductLimiter,
    checkPermission('delete_products'),
    productsController.deleteProduct
);

module.exports = router;
