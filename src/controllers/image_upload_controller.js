const cloudinary = require('../config/cloudenary.config');
const { optimizeImage } = require('../utils/imageOptimizer');
const storeImageController = require('./store_images_controller');
const stream = require('stream');

module.exports = {
    async uploadStoreImage(req, res) {
        const { file, body } = req;
        const { aspect, imageType, storeId, storeName, storeType, user } = body;
        let cloudinaryResult = null;

        // Parsear usuario si viene como string JSON
        let userObj = user;
        if (typeof user === 'string') {
            try {
                userObj = JSON.parse(user);
            } catch (e) {
                userObj = {};
            }
        }

        try {
            // 1. Validaciones iniciales
            if (!file || !file.buffer) {
                return res.status(400).json({ error: 'Archivo no válido o faltante' });
            }

            const requiredFields = ['aspect', 'storeId', 'storeName', 'storeType', 'user'];
            const missingFields = requiredFields.filter(field => !body[field]);
            if (missingFields.length > 0) {
                return res.status(400).json({
                    error: 'Datos incompletos',
                    missingFields
                });
            }

            // 2. Optimizar imagen
            const maxWidth = imageType === 'banner' ? 1200 : getWidthFromAspect(aspect);
            const maxHeight = imageType === 'banner' ? null : getHeightFromAspect(aspect);
            
            const optimizedBuffer = await optimizeImage(file.buffer, maxWidth, maxHeight);

            // 3. Subir a Cloudinary
            cloudinaryResult = await uploadToCloudinary(
                optimizedBuffer, 
                storeName, 
                storeType, 
                imageType, 
                userObj
            );

            // 4. Guardar en base de datos
            const imageData = {
                image_url: cloudinaryResult.secure_url,
                public_id: cloudinaryResult.public_id,
                format: cloudinaryResult.format,
                width: cloudinaryResult.width,
                height: cloudinaryResult.height,
                bytes: cloudinaryResult.bytes,
                uploaded_by: userObj.id
            };

            const newStore = await storeImageController.createStoreImage(storeId, imageData);             
           

            // 5. Respuesta exitosa
            return res.json(newStore);

        } catch (error) {
            console.error('❌ Error al procesar la imagen:', error);
            
            // Limpieza en caso de error después de subir a Cloudinary
            if (cloudinaryResult?.public_id) {
                await cloudinary.uploader.destroy(cloudinaryResult.public_id)
                    .catch(e => console.error('Error limpiando imagen de Cloudinary:', e));
            }

            return res.status(500).json({
                error: 'Error al procesar la imagen',
                details: process.env.NODE_ENV === 'development' ? error.message : null,
                requestMetadata: {
                    storeId: body?.storeId || null,
                    user: userObj?.email || null
                }
            });
        }
    }
};

// Funciones auxiliares
function getWidthFromAspect(aspect) {
    const baseSize = 300;
    switch (aspect) {
        case '1': return baseSize;
        case '1.5': return baseSize;
        case '0.666': return Math.round(baseSize * 0.666);
        case 'free': return null;
        default: return baseSize;
    }
}

function getHeightFromAspect(aspect) {
    const baseSize = 300;
    switch (aspect) {
        case '1': return baseSize;
        case '1.5': return Math.round(baseSize / 1.5);
        case '0.666': return baseSize;
        case 'free': return null;
        default: return null;
    }
}

async function uploadToCloudinary(buffer, storeName, storeType, imageType, user) {
    const uploadOptions = {
        folder: `siloe/stores`,
        public_id: `${storeName || 'store'}_${Date.now()}`,
        format: 'webp',
        resource_type: 'image',
        context: {
            caption: `Name: ${storeName || ''}`,
            alt: `Type (${storeType || ''})`,
            uploadedBy: user.email || '',
        },
        tags: ['store', storeType || '', imageType || ''].filter(Boolean)
    };

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => error ? reject(error) : resolve(result)
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(uploadStream);
    });
}

function formatImageResponse(dbImage, cloudinaryData) {
    return {
        id: dbImage.id,
        url: dbImage.image_url,
        publicId: dbImage.public_id,
        format: dbImage.format,
        dimensions: `${dbImage.width}x${dbImage.height}`,
        isPrimary: dbImage.is_primary,
        uploadedAt: dbImage.created_at,
        cloudinaryData: {
            storagePath: cloudinaryData.folder,
            originalFormat: cloudinaryData.original_format
        }
    };
}

function buildMetadata(storeName, aspect, imageType) {
    return {
        originalStoreName: storeName,
        processingDetails: {
            aspectRatio: aspect,
            optimized: true,
            optimizationType: imageType || 'standard'
        }
    };
}
