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
        const { aspect, imageType, storeId, storeName, storeType, user, companyName } = body;
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
                userObj,
                companyName
            );

            // 4. Verificar que la subida a Cloudinary fue exitosa
            if (!cloudinaryResult || !cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
                console.error('❌ Subida a Cloudinary falló - Respuesta incompleta:', cloudinaryResult);
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Ups! Ocurrio un error al subir la imagen, por favor intente de nuevo',
                    
                });
            }          

            // 5. Guardar en base de datos (solo si Cloudinary fue exitoso)
            const imageData = {
                image_url: cloudinaryResult.secure_url,
                public_id: cloudinaryResult.public_id,
                format: cloudinaryResult.format,
                width: cloudinaryResult.width,
                height: cloudinaryResult.height,
                bytes: cloudinaryResult.bytes,
                uploaded_by: userObj.id
            };

            const response = await storeImageController.createStoreImage(storeId, imageData);

            // 6. Respuesta exitosa
            return res.json(response);

        } catch (error) {           

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

async function uploadToCloudinary(buffer, storeName, storeType, imageType, user, companyName) {
    const uploadOptions = {
        folder: `FabriApp/stores/${companyName}`,
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


