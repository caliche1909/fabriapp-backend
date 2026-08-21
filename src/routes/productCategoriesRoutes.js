const express = require('express');
const { productCategoriesController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA CATEGORÍAS DE PRODUCTOS
const {
    createSmartRateLimit,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const listCategoriesLimiter = createQueryLimiter({ trustedIPs: [] });

const writeCategoryLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 20,
    maxByUser: 60,
    message: 'Límite de operaciones de categorías alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

/**
 * PERMISOS: las categorías son parte del catálogo de productos, por lo que se gatean con los
 * permisos del submódulo `products` (no hay permiso propio sembrado): ver → view_products,
 * crear → create_products, editar → edit_products, eliminar → delete_products.
 * La compañía se toma SIEMPRE de la sesión (req.user.companyId).
 */

// api/product_categories/

router.get('/list',
    verifyToken,
    listCategoriesLimiter,
    checkPermission('view_products'),
    productCategoriesController.getCategories
);

router.post('/create',
    verifyToken,
    writeCategoryLimiter,
    checkPermission('create_products'),
    productCategoriesController.createCategory
);

router.put('/update/:id',
    verifyToken,
    writeCategoryLimiter,
    checkPermission('edit_products'),
    productCategoriesController.updateCategory
);

router.delete('/delete/:id',
    verifyToken,
    writeCategoryLimiter,
    checkPermission('delete_products'),
    productCategoriesController.deleteCategory
);

module.exports = router;
