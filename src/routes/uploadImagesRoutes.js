const express = require('express');
const { upload_store_imageController } = require('../controllers');
const { verifyToken, verifySeller } = require('../middlewares/jwt.middleware');
const upload = require('../middlewares/uploadImages.middleware');

const router = express.Router();

// api/upload_images/
router.post('/store', verifyToken, verifySeller, upload.single('image'), upload_store_imageController.uploadStoreImage); // subir imagen de tienda
router.delete('/delete', verifyToken, verifySeller, upload_store_imageController.deleteStoreImage); // eliminar imagen de tienda

module.exports = router;