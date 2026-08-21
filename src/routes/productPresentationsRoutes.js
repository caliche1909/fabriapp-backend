const express = require('express');
const { productPresentationsController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');

// 🛡️ RATE LIMITING PARA PRESENTACIONES DE PRODUCTOS
const {
    createSmartRateLimit,
    createQueryLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

const listPresentationsLimiter = createQueryLimiter({ trustedIPs: [] });

const writePresentationLimiter = createSmartRateLimit({
    windowMs: 15 * 60 * 1000,
    maxByIP: 25,
    maxByUser: 80,
    message: 'Límite de operaciones de presentaciones alcanzado',
    trustedIPs: [],
    enableOwnerBonus: true
});

/**
 * PERMISOS: las presentaciones son parte del catálogo de productos, por lo que se gatean con los
 * permisos del submódulo `products`: ver → view_products, crear → create_products,
 * editar → edit_products, eliminar → delete_products. La compañía SIEMPRE de la sesión.
 */

// api/product_presentations/

router.get('/list',
    verifyToken,
    listPresentationsLimiter,
    checkPermission('view_products'),
    productPresentationsController.getPresentations
);

router.post('/create',
    verifyToken,
    writePresentationLimiter,
    checkPermission('create_products'),
    productPresentationsController.createPresentation
);

router.put('/update/:id',
    verifyToken,
    writePresentationLimiter,
    checkPermission('edit_products'),
    productPresentationsController.updatePresentation
);

router.delete('/delete/:id',
    verifyToken,
    writePresentationLimiter,
    checkPermission('delete_products'),
    productPresentationsController.deletePresentation
);

module.exports = router;
