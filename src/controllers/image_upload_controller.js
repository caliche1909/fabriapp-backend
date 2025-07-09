const cloudinary = require('../config/cloudenary.config');
const { optimizeImage } = require('../utils/imageOptimizer');
const storeImageController = require('./store_images_controller');
const stream = require('stream');
const { store_images, stores, sequelize, users } = require('../models');
const { notifyAdmin } = require('../utils/emailNotifier');

module.exports = {

    // Metodo para eliminar una imagen de tienda
    async deleteStoreImage(req, res) {
        const { storeId, imageId, publicId, image_url, isPrimary, user } = req.body

        console.log('🔥 INICIO deleteStoreImage - Datos recibidos:', {
            storeId,
            imageId,
            publicId,
            image_url,
            isPrimary,
            user: user?.email || 'No user'
        });

        if (!storeId || !imageId || !publicId || !image_url || !user) {
            console.log('❌ Datos incompletos:', { storeId, imageId, publicId, image_url, user });
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Datos incompletos para eliminar la imagen',
                store: null
            });
        }

        const transaction = await sequelize.transaction();
        console.log('🔄 Transacción iniciada:', transaction.id);
        let cloudinaryDeleted = false;
        let cloudinaryExists = false;

        try {
            console.log('🔸 PASO 1: Verificando existencia en BD y Cloudinary...');

            // 🔸 PASO 1: Verificar existencia en AMBOS lugares primero          

            // 1.1 Verificar en Base de Datos (debe pertenecer a la tienda correcta)
            const imageRecord = await store_images.findOne({
                where: {
                    id: imageId,
                    store_id: storeId
                },
                transaction
            });
            const existsInDatabase = !!imageRecord;
            console.log('🗄️ Existe en BD:', existsInDatabase, imageRecord ? `ID: ${imageRecord.id}` : 'No encontrada');

            // 1.2 Verificar en Cloudinary
            console.log('☁️ Verificando en Cloudinary...');
            try {
                const cloudinaryInfo = await cloudinary.api.resource(publicId);
                if (cloudinaryInfo && cloudinaryInfo.public_id) {
                    cloudinaryExists = true;
                    console.log('☁️ Existe en Cloudinary:', cloudinaryInfo.public_id);
                }
            } catch (cloudinaryError) {
                console.log('☁️ Error verificando Cloudinary:', cloudinaryError.error?.http_code || cloudinaryError.message);
                if (cloudinaryError.error && cloudinaryError.error.http_code === 404) {
                    cloudinaryExists = false;
                    console.log('☁️ No existe en Cloudinary (404)');
                } else {
                    // Si hay error de conectividad, asumimos que existe para intentar eliminarla
                    cloudinaryExists = true;
                    console.log('☁️ Error de conectividad, asumiendo que existe');
                }
            }

            // 🔸 PASO 2: Validar que existe en al menos uno de los dos lugares
            console.log('🔸 PASO 2: Validando existencia - BD:', existsInDatabase, 'Cloudinary:', cloudinaryExists);
            if (!existsInDatabase && !cloudinaryExists) {
                console.log('❌ No existe en ningún lugar, haciendo rollback');
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La imagen que intenta eliminar NO EXISTE',
                    store: null
                });
            }

            // 🔸 PASO 3: Eliminar según los casos
            console.log('🔸 PASO 3: Iniciando eliminación...');
            let databaseDeleted = false;

            // CASO 1: Existe en BD y Cloudinary → Eliminar de ambos
            if (existsInDatabase && cloudinaryExists) {
                console.log('📋 CASO 1: Eliminando de BD y Cloudinary...');

                // Eliminar de BD
                console.log('🗄️ Eliminando de BD...');
                await store_images.destroy({
                    where: { id: imageId },
                    transaction
                });
                databaseDeleted = true;
                console.log('✅ Eliminada de BD exitosamente');

                // Eliminar de Cloudinary
                console.log('☁️ Eliminando de Cloudinary...');
                try {
                    await cloudinary.uploader.destroy(publicId);
                    cloudinaryDeleted = true;
                    console.log(`✅ Eliminada de Cloudinary exitosamente`);
                } catch (error) {
                    console.log('❌ Error eliminando de Cloudinary:', error.message);
                    await transaction.rollback();
                    console.log('🔄 Rollback por error de Cloudinary');
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar imagen, por favor intente mas tarde',
                        store: null
                    });
                }

                // Manejar imagen principal si es necesario
                if (isPrimary) {
                    console.log('🖼️ Era imagen principal, buscando nueva imagen principal...');
                    const newPrimary = await store_images.findOne({
                        where: { store_id: storeId },
                        order: [['created_at', 'DESC']],
                        transaction
                    });
                    if (newPrimary) {
                        await newPrimary.update({ is_primary: true }, { transaction });
                        console.log('✅ Nueva imagen principal asignada:', newPrimary.id);
                    } else {
                        console.log('ℹ️ No hay más imágenes para asignar como principal');
                    }
                }
            }
            // CASO 2: Existe solo en BD → Eliminar solo de BD
            else if (existsInDatabase && !cloudinaryExists) {
                console.log('📋 CASO 2: Eliminando solo de BD...');

                await store_images.destroy({
                    where: { id: imageId },
                    transaction
                });
                databaseDeleted = true;
                console.log('✅ Eliminada de BD exitosamente (no existía en Cloudinary)');

                // Manejar imagen principal si es necesario
                if (isPrimary) {
                    console.log('🖼️ Era imagen principal, buscando nueva imagen principal...');
                    const newPrimary = await store_images.findOne({
                        where: { store_id: storeId },
                        order: [['created_at', 'DESC']],
                        transaction
                    });
                    if (newPrimary) {
                        await newPrimary.update({ is_primary: true }, { transaction });
                        console.log('✅ Nueva imagen principal asignada:', newPrimary.id);
                    } else {
                        console.log('ℹ️ No hay más imágenes para asignar como principal');
                    }
                }
            }
            // CASO 3: Existe solo en Cloudinary → Eliminar solo de Cloudinary
            else if (!existsInDatabase && cloudinaryExists) {
                console.log(`📋 CASO 3: Eliminando solo de Cloudinary (no existe en BD)`);

                try {
                    await cloudinary.uploader.destroy(publicId);
                    cloudinaryDeleted = true;
                    console.log('✅ Eliminada de Cloudinary exitosamente (no existía en BD)');
                } catch (error) {
                    console.log('❌ Error eliminando de Cloudinary (CASO 3):', error.message);
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar imagen, intente de nuevo',
                        store: null
                    });
                }
            }

            console.log('🔸 PASO 4: Recuperando tienda actualizada...');
            // Recuperar tienda actualizada con estructura consistente
            const updatedStore = await stores.findByPk(storeId, {
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'company_id', // ✅ Incluir company_id para consistencia
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion
                    [stores.sequelize.fn('ST_Y', stores.sequelize.col('ubicacion')), 'latitude'],
                    [stores.sequelize.fn('ST_X', stores.sequelize.col('ubicacion')), 'longitude'],
                    'opening_time',
                    'closing_time',
                    'city',
                    'state',
                    'country'
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
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status']
                    },
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary']
                    }
                ],
                transaction
            });

            console.log('📊 Tienda recuperada:', updatedStore ? `ID: ${updatedStore.id}` : 'No encontrada');
            console.log('🖼️ Imágenes restantes:', updatedStore?.images?.length || 0);

            // 🎨 Formatear respuesta para el frontend (igual que otros controladores)
            const storeData = updatedStore.toJSON();

            // Formatear manager si existe para satisfacer interfaz User
            if (storeData.manager) {
                let countryCode = undefined;
                let phoneNumber = undefined;

                if (storeData.manager.phone) {
                    if (storeData.manager.phone.includes('-')) {
                        [countryCode, phoneNumber] = storeData.manager.phone.split('-');
                    } else {
                        phoneNumber = storeData.manager.phone;
                    }
                }

                storeData.manager = {
                    id: storeData.manager.id,
                    name: storeData.manager.first_name,
                    lastName: storeData.manager.last_name,
                    email: storeData.manager.email,
                    countryCode: countryCode,
                    phone: phoneNumber,
                    status: storeData.manager.status
                };
            }

            // ✅ Asegurar que images sea un array (puede venir como null)
            if (!storeData.images) {
                storeData.images = [];
            }

            // 🔸 PASO 5: Confirmar la transacción y devolver respuesta
            console.log('🔸 PASO 5: Confirmando transacción...');
            await transaction.commit();
            console.log('✅ Transacción confirmada exitosamente');

            console.log('🎉 ÉXITO: Imagen eliminada correctamente');
            return res.status(200).json({
                success: true,
                status: 200,
                message: "Imagen eliminada exitosamente",
                store: storeData
            });

        } catch (error) {
            console.log('❌ ERROR CAPTURADO en catch principal:', error.message);
            console.log('📋 Stack trace:', error.stack);
            console.log('🔍 Detalles del error:', {
                name: error.name,
                message: error.message,
                code: error.code,
                sql: error.sql
            });

            // 🔸 Solo hacer rollback si la transacción NO ha sido confirmada
            if (!transaction.finished) {
                console.log('🔄 Haciendo rollback de la transacción...');
                await transaction.rollback();
                console.log('✅ Rollback completado');
            } else {
                console.log('ℹ️ Transacción ya terminada, no se hace rollback');
            }

            // 🔍 Manejo específico de errores de conectividad
            if (error.message && error.message.includes('ENOTFOUND')) {
                console.log('🌐 Error de conectividad detectado');
                return res.status(503).json({
                    success: false,
                    status: 503,
                    message: 'Problemas de conectividad. La imagen puede haber sido eliminada parcialmente.',
                    error_type: 'CONNECTIVITY_ERROR',
                    store: null
                });
            }

            // Error genérico
            console.log('🚨 Devolviendo error genérico al cliente');
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al eliminar la imagen',
                error_type: 'GENERAL_ERROR',
                details: process.env.NODE_ENV === 'development' ? error.message : null,
                store: null
            });
        }

    },

    // Método para subir una imagen de tienda a cloudinary y guardar en la base de datos
    async uploadStoreImage(req, res) {
        const { file, body } = req;
        const { aspect, imageType, storeId, storeName, storeType, companyName, ownerId, ownerEmail } = body;
        let cloudinaryResult = null;

        console.log("📸 INICIO uploadStoreImage - Datos recibidos:", {
            storeId, storeName, storeType, companyName, 
            hasOwnerId: !!ownerId,
            hasOwnerEmail: !!ownerEmail,
            aspect, imageType
        });

        try {
            // 1. Validaciones iniciales
            if (!file || !file.buffer) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Archivo no válido o faltante'
                });
            }

            const requiredFields = ['aspect', 'storeId', 'storeName', 'storeType', 'companyName', 'ownerId', 'ownerEmail'];
            const missingFields = requiredFields.filter(field => !body[field]);
            if (missingFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos',
                    missingFields
                });
            }

            // 2. Verificar que la tienda existe
            const store = await stores.findByPk(storeId);
            if (!store) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Tienda no encontrada'
                });
            }

            // 3. Optimizar imagen (tamaño pequeño para tarjetas de tienda)
            const maxWidth = getWidthFromAspect(aspect);
            const maxHeight = getHeightFromAspect(aspect);
            const { optimizeImage } = require('../utils/imageOptimizer');
            const optimizedBuffer = await optimizeImage(file.buffer, maxWidth, maxHeight);

            // 4. Subir a Cloudinary con estructura: FabriApp/ownerEmail/companyName/stores
            cloudinaryResult = await uploadToCloudinaryUnified(optimizedBuffer, {
                ownerEmail: ownerEmail,
                companyName: companyName,
                itemName: storeName,
                imageType: imageType || 'store_image',
                entityType: 'stores',
                tags: [storeName, storeType]
            });

            // 5. Verificar que la subida a Cloudinary fue exitosa
            if (!cloudinaryResult || !cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
                console.error('❌ Subida a Cloudinary falló - Respuesta incompleta:', cloudinaryResult);
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al subir la imagen, por favor intente de nuevo'
                });
            }

            // 6. Guardar en base de datos usando el controlador de store_images
            const imageData = {
                image_url: cloudinaryResult.secure_url,
                public_id: cloudinaryResult.public_id,
                format: cloudinaryResult.format,
                width: cloudinaryResult.width,
                height: cloudinaryResult.height,
                bytes: cloudinaryResult.bytes,
                uploaded_by: req.user?.id || ownerId
            };

            const response = await storeImageController.createStoreImage(storeId, imageData);

            console.log('✅ Imagen de tienda subida exitosamente:', {
                storeId: store.id,
                newImageUrl: cloudinaryResult.secure_url,
                publicId: cloudinaryResult.public_id
            });

            // 7. Respuesta exitosa
            return res.json(response);

        } catch (error) {
            console.error('❌ Error en uploadStoreImage:', error);

            // Limpieza en caso de error después de subir a Cloudinary
            if (cloudinaryResult?.public_id) {
                await cloudinary.uploader.destroy(cloudinaryResult.public_id)
                    .catch(e => console.error('Error limpiando imagen de Cloudinary:', e));
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al subir imagen',
                details: process.env.NODE_ENV === 'development' ? error.message : null
            });
        }
    },

    // Método para subir una imagen de perfil de usuario a cloudinary y guardar en la base de datos
    async uploadProfileImage(req, res) {
        const { file, body } = req;
        const { ownerId, userName, userEmail, companyName, aspect, imageType, ownerEmail, currentImagePublicId } = body;
        let cloudinaryResult = null;

        console.log("📸 INICIO uploadProfileImage - Datos recibidos:", {
            ownerId, userName, userEmail, companyName,
            hasOwnerEmail: !!ownerEmail,
            aspect, imageType,
            hasCurrentImagePublicId: !!currentImagePublicId
        });

        try {
            // 1. Validaciones iniciales
            if (!file || !file.buffer) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Archivo no válido o faltante'
                });
            }

            const requiredFields = ['ownerId', 'userName', 'userEmail', 'companyName', 'aspect'];
            const missingFields = requiredFields.filter(field => !body[field]);
            if (missingFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos',
                    missingFields
                });
            }

            // 2. Verificar que el usuario existe
            const user = await users.findByPk(ownerId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Usuario no encontrado'
                });
            }

            // 3. Eliminar imagen anterior si existe (usando public_id desde BD)
            if (currentImagePublicId) {
                try {
                    const deleteResult = await cloudinary.uploader.destroy(currentImagePublicId);

                    if (deleteResult.result === 'ok') {

                        previousImageDeleted = true;
                    }
                } catch (deleteError) {
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Ups! Ocurrio un error, por favor intente de nuevo'
                    });
                }
            }

            // 4. Optimizar imagen (tamaño estándar para perfiles)
            const maxWidth = 400;
            const maxHeight = 400;
            const { optimizeImage } = require('../utils/imageOptimizer');
            const optimizedBuffer = await optimizeImage(file.buffer, maxWidth, maxHeight);

            // 5. Subir a Cloudinary con estructura: FabriApp/ownerEmail/companyName/users
            cloudinaryResult = await uploadToCloudinaryUnified(optimizedBuffer, {
                ownerEmail: ownerEmail,
                companyName: companyName,
                itemName: userName,
                imageType: imageType || 'profile_image',
                entityType: 'users',
                tags: [userName]
            });

            // 6. Verificar que la subida a Cloudinary fue exitosa
            if (!cloudinaryResult || !cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
                console.error('❌ Subida a Cloudinary falló - Respuesta incompleta:', cloudinaryResult);
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al subir la imagen, por favor intente de nuevo'
                });
            }

            // 7. Actualizar imagen en tabla users
            await user.update({
                image_url: cloudinaryResult.secure_url,
                image_public_id: cloudinaryResult.public_id
            });

            console.log('✅ Imagen de perfil subida exitosamente:', {
                userId: user.id,
                newImageUrl: cloudinaryResult.secure_url,
                publicId: cloudinaryResult.public_id
            });

            // 8. Respuesta exitosa
            return res.json({
                success: true,
                status: 200,
                message: "Imagen de perfil subida exitosamente",
                imageUrl: cloudinaryResult.secure_url,
                imagePublicId: cloudinaryResult.public_id
            });

        } catch (error) {
            console.error('❌ Error en uploadProfileImage:', error);

            // Limpieza en caso de error después de subir a Cloudinary
            if (cloudinaryResult?.public_id) {
                await cloudinary.uploader.destroy(cloudinaryResult.public_id)
                    .catch(e => console.error('Error limpiando imagen de Cloudinary:', e));
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al subir imagen',
                details: process.env.NODE_ENV === 'development' ? error.message : null
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

// 🎯 FUNCIÓN UNIFICADA PARA SUBIR IMÁGENES A CLOUDINARY
// Estructura: FabriApp/ownerEmail/companyName/{entityType}
async function uploadToCloudinaryUnified(buffer, {
    ownerEmail,
    companyName,
    itemName,        // nombre del usuario o tienda
    imageType,       // 'profile_image', 'store_image', etc.
    entityType,      // 'users' o 'stores'
    tags = [],       // tags adicionales
    transformation = null
}) {
    // Normalizar solo para nombres de archivo y tags (NO para carpetas)
    const normalizeForFileName = (str) => {
        return str
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[áàäâã]/g, 'a')
            .replace(/[éèëê]/g, 'e')
            .replace(/[íìïî]/g, 'i')
            .replace(/[óòöô]/g, 'o')
            .replace(/[úùüû]/g, 'u')
            .replace(/ñ/g, 'n')
            .replace(/[^\w-]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_|_$/g, '');
    };

    // Generar estructura de carpetas SIN normalizar: FabriApp/ownerEmail/companyName/{entityType}
    const folderPath = `FabriApp/${ownerEmail}/${companyName}/${entityType}`;

    // Generar public_id único: itemName_imageType_timestamp_hash
    const timestamp = Date.now();
    const hash = Math.random().toString(36).substring(2, 8);
    const publicId = `${normalizeForFileName(itemName)}_${imageType}_${timestamp}_${hash}`;

    // Tags base + tags adicionales (normalizados para Cloudinary)
    const baseTags = ['fabriapp', entityType.slice(0, -1), imageType, normalizeForFileName(companyName)];
    const normalizedAdditionalTags = tags.map(tag => normalizeForFileName(tag));
    const allTags = [...baseTags, ...normalizedAdditionalTags].filter(Boolean);

    const uploadOptions = {
        folder: folderPath,
        public_id: publicId,
        format: 'webp',
        resource_type: 'image',
        quality: 85,
        context: {
            caption: `${entityType}: ${itemName}`,
            alt: `${entityType} image`,
            uploadedBy: ownerEmail,
            company: companyName
        },
        tags: allTags,
        transformation: transformation || [
            {
                width: entityType === 'users' ? 400 : 300,
                height: entityType === 'users' ? 400 : 300,
                crop: 'fill',
                gravity: entityType === 'users' ? 'face' : 'center',
                quality: 'auto:good'
            }
        ]
    };

    console.log("☁️ Subiendo imagen a Cloudinary:", {
        folder: uploadOptions.folder,
        public_id: uploadOptions.public_id,
        tags: uploadOptions.tags,
        entityType
    });

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    console.error('❌ Error en Cloudinary:', error);
                    reject(error);
                } else {
                    console.log('✅ Subida exitosa a Cloudinary:', {
                        public_id: result.public_id,
                        secure_url: result.secure_url,
                        folder: result.folder,
                        width: result.width,
                        height: result.height,
                        bytes: result.bytes
                    });
                    resolve(result);
                }
            }
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(uploadStream);
    });
}


