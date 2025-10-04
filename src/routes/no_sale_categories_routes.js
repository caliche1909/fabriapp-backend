const express = require('express');
const { no_saleCategories } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');
const {
    createListRoutesByCompanyLimiter,
    createCreateRouteLimiter,
    createUpdateRouteLimiter,
    createDeleteRouteLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// api/no-sale-categories/

// 🛡️ CONFIGURAR LIMITADORES ESPECÍFICOS PARA CATEGORÍAS DE NO-VENTA
const listCategoriesByCompanyLimiter = createListRoutesByCompanyLimiter(); // Reutilizar el limiter de consultas
const createCategoryLimiter = createCreateRouteLimiter(); // Reutilizar para creación
const updateCategoryLimiter = createUpdateRouteLimiter(); // Reutilizar para actualización  
const deleteCategoryLimiter = createDeleteRouteLimiter(); // Reutilizar para eliminación

/*
    PERMISOS SUGERIDOS PARA REGISTRAR EN LA BASE DE DATOS:
   
    2. create_no_sale_category_by_company -> Permite crear una categoría de no-venta para una compañía
    3. update_no_sale_category_by_company -> Permite actualizar una categoría de no-venta de una compañía
    4. delete_no_sale_category_by_company -> Permite eliminar una categoría de no-venta de una compañía
    5. view_global_no_sale_categories -> Permite ver las categorías globales de no-venta
*/

// 🏢 Obtener categorías de no-venta por compañía (globales + específicas)
router.get('/company/:companyId',
    verifyToken,
    listCategoriesByCompanyLimiter, // 🔒 40 consultas/15min (datos que se guardan en Redux)    
    no_saleCategories.getCategoriesByCompany
);

// 🌍 Obtener solo categorías globales (para administradores)
// router.get('/global',
//     verifyToken,
//     listCategoriesByCompanyLimiter, // 🔒 40 consultas/15min
//     checkPermission('view_global_no_sale_categories'), // permiso para ver categorías globales
//     no_saleCategories.getGlobalCategories
// );

// 📝 Crear nueva categoría de no-venta para una compañía
// router.post('/create/:companyId',
//     verifyToken,
//     createCategoryLimiter, // 🔒 10 creaciones/hora (operación administrativa)
//     checkPermission('create_no_sale_category_by_company'),
//     no_saleCategories.createCategoryForCompany
// );

// ✏️ Actualizar categoría de no-venta existente
// router.put('/update/:id',
//     verifyToken,
//     updateCategoryLimiter, // 🔒 30 actualizaciones/15min (ajustes de configuración)
//     checkPermission('update_no_sale_category_by_company'),
//     no_saleCategories.updateCategory
// );

// 🗑️ Eliminar categoría de no-venta
// router.delete('/delete/:id',
//     verifyToken,
//     deleteCategoryLimiter, // 🔒 5 eliminaciones/hora (operación crítica)
//     checkPermission('delete_no_sale_category_by_company'),
//     no_saleCategories.deleteCategory
// );

module.exports = router;