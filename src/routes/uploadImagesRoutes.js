const express = require('express');
const { image_uploadController } = require('../controllers');
const { verifyToken, checkPermission } = require('../middlewares/jwt.middleware');
const upload = require('../middlewares/uploadImages.middleware');

// 🛡️ IMPORTAR RATE LIMITING PARA SUBIDA DE IMÁGENES
const {
    createImageUploadLimiter,
    createGeneralLimiter
} = require('../middlewares/smartRateLimit.middleware');

const router = express.Router();

// 🛡️ LIMITADORES PERSONALIZADOS PARA SUBIDA DE IMÁGENES
// Subir imagen de tienda - Moderado (consume recursos del servidor)
const uploadStoreImageLimiter = createImageUploadLimiter({
    windowMs: 60 * 60 * 1000,      // 1 hora
    maxByIP: 5,                   // 20 imágenes por hora por IP
    maxByUser: 15,                 // 60 imágenes por hora por usuario
    message: "Límite de subida de imágenes de tienda alcanzado",
    enableOwnerBonus: true,        // OWNERS: 90 imágenes/hora
    skipSuccessfulRequests: true   // Solo contar uploads fallidos
});

// Subir imagen de perfil - Más restrictivo (menos frecuente)
const uploadProfileImageLimiter = createImageUploadLimiter({
    windowMs: 60 * 60 * 1000,      // 1 hora
    maxByIP: 5,                   // 10 imágenes por hora por IP
    maxByUser: 15,                 // 25 imágenes por hora por usuario
    message: "Límite de subida de imágenes de perfil alcanzado",
    enableOwnerBonus: true,        // OWNERS: 37 imágenes/hora
    skipSuccessfulRequests: true   // Solo contar uploads fallidos
});

// Eliminar imagen - Más generoso (operación menos costosa)
const deleteImageLimiter = createGeneralLimiter({
    windowMs: 15 * 60 * 1000,      // 15 minutos
    maxByIP: 10,                   // 40 eliminaciones por IP
    maxByUser: 15,                // 100 eliminaciones por usuario
    message: "Límite de eliminación de imágenes alcanzado",
    enableOwnerBonus: true,        // OWNERS: 150 eliminaciones/15min
    skipSuccessfulRequests: false  // Contar todas las eliminaciones
});

// Subir imagen de logo de empresa - Más restrictivo (menos frecuente)
const uploadCompanyLogoImageLimiter = createImageUploadLimiter({
    windowMs: 60 * 60 * 1000,      // 1 hora
    maxByIP: 5,                   // 10 imágenes por hora por IP
    maxByUser: 10,                 // 25 imágenes por hora por usuario
    message: "Límite de subida de imágenes de logo de empresa alcanzado",
    enableOwnerBonus: true,        // OWNERS: 37 imágenes/hora
    skipSuccessfulRequests: true   // Solo contar uploads fallidos
});

// api/upload_images/************************************************************************************** */

// subir imagen de tienda
router.post('/store',
    verifyToken,
    checkPermission('upload_image_store'),
    uploadStoreImageLimiter, // 🔒 60 imágenes/hora (consume recursos)
    upload.single('image'),
    image_uploadController.uploadStoreImage
);

// eliminar imagen de tienda
router.delete('/delete',
    verifyToken,
    checkPermission('delete_image_store'),
    deleteImageLimiter, // 🔒 100 eliminaciones/15min (operación menos costosa)
    image_uploadController.deleteStoreImage
);

// subir imagen de perfil de usuario
router.post('/profile',
    verifyToken,
    checkPermission('upload_image_profile'),
    uploadProfileImageLimiter, // 🔒 25 imágenes/hora (menos frecuente)
    upload.single('image'),
    image_uploadController.uploadProfileImage
);

// subir imagen de logo de empresa
router.post('/company_logo',
    verifyToken,
    uploadCompanyLogoImageLimiter, // 🔒 10 imágenes/hora (menos frecuente)
    upload.single('image'),
    image_uploadController.uploadCompanyLogoImage
);

// eliminar imagen de logo de empresa
router.delete('/company_logo',
    verifyToken,
    deleteImageLimiter, // 🔒 100 eliminaciones/15min (operación menos costosa)
    image_uploadController.deleteCompanyLogoImage
);

// eliminar imagen de perfil de usuario
router.delete('/delete_image_profile',
    verifyToken,
    checkPermission('delete_image_profile'),
    deleteImageLimiter, // 🔒 100 eliminaciones/15min (operación menos costosa)
    image_uploadController.deleteProfileImage
);

module.exports = router;