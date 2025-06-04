const cloudinary = require('../config/cloudenary.config');
const { optimizeImage } = require('../utils/imageOptimizer');
const storeImageController = require('./store_images_controller');
const stream = require('stream');
const { store_images, stores, sequelize } = require('../models');
const { notifyAdmin } = require('../utils/emailNotifier');

module.exports = {

    // Metodo para eliminar una imagen de tienda
    async deleteStoreImage(req, res) {
        const { storeId, imageId, publicId, image_url, isPrimary, user } = req.body

        if (!storeId || !imageId || !publicId || !image_url || !user) {
            return res.status(400).json({
                success: false,
                status: '400',
                message: 'Datos incompletos para eliminar la imagen',
                store: null
            });
        }

        const transaction = await sequelize.transaction();
        let cloudinaryDeleted = false;

        try {
            // 1. Verificar que la imagen existe en la BD
            const imageRecord = await store_images.findOne({
                where: { id: imageId, store_id: storeId },
                transaction
            });

            if (!imageRecord) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: '404',
                    message: 'La imagen no existe en la base de datos',
                    store: null
                });
            }

            // 2. Eliminar de Cloudinary primero
            const cloudinaryResult = await cloudinary.uploader.destroy(publicId);

            if (cloudinaryResult.result !== 'ok') {
                await transaction.rollback();
                return res.status(500).json({
                    success: false,
                    status: '500',
                    message: 'No se pudo eliminar la imagen de Cloudinary',
                    store: null
                });
            }

            cloudinaryDeleted = true;

            // 3. Eliminar de la base de datos
            await store_images.destroy({
                where: { id: imageId },
                transaction
            });

            // 4. Si era la imagen principal, asignar una nueva
            if (isPrimary) {
                const newPrimary = await store_images.findOne({
                    where: { store_id: storeId },
                    order: [['created_at', 'DESC']],
                    transaction
                });

                if (newPrimary) {
                    await newPrimary.update({ is_primary: true }, { transaction });
                }
            }           

            // Recuperar tienda actualizada
            const updatedStore = await stores.findByPk(storeId, {
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'latitude',
                    'longitude',
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country',
                ],
                include: [
                    {
                        association: 'store_type',
                        as: 'store_type',
                        attributes: ['id', 'name']
                    },
                    {
                        association: 'manager',
                        as: 'manager',
                        attributes: ['name', 'email', 'phone', 'status']
                    },
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary'],
                    }
                ],
                transaction
            });

            // 5. Confirmar la transacción
            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: '200',
                message: 'Imagen eliminada exitosamente',
                store: updatedStore
            });

        } catch (error) {

            console.log("ERROR AL ELIMINAR IMAGEN:", error);
            // Rollback en caso de error
            await transaction.rollback();

            // Intentar recuperar la imagen en Cloudinary si fue eliminada pero falló la BD
            if (cloudinaryDeleted) {
                try {
                    await cloudinary.uploader.upload(image_url, {
                        public_id: publicId,
                        overwrite: true,
                        invalidate: true
                    });
                    console.warn('Imagen recreada en Cloudinary después de fallo en BD');
                } catch (restoreError) {
                    console.error('Error crítico al restaurar imagen en Cloudinary:', restoreError);

                    // Aquí deberías notificar al equipo para acción manual
                    await notifyAdmin({
                        type: 'ORPHANED_IMAGE',
                        publicId: publicId,
                        imageUrl: image_url,
                        userId: user.id
                    });

                    console.error('Error al eliminar imagen:', {
                        error: error instanceof Error ? error.message : error,
                        timestamp: new Date().toISOString()
                    });

                    return res.status(500).json({
                        success: false,
                        status: '500',
                        message: 'Error al eliminar la imagen',
                        store: null
                    });
                }
            }

        }

    },

    // Método para subir una imagen de tienda a cloudinary y guardar en la base de datos
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
    },


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


