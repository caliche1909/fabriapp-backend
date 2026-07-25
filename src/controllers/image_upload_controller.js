const cloudinary = require('../config/cloudenary.config');
const { optimizeImage } = require('../utils/imageOptimizer');
const storeImageController = require('./store_images_controller');
const stream = require('stream');
const { store_images, stores, sequelize, users, user_companies, companies } = require('../models');
const { notifyAdmin } = require('../utils/emailNotifier');

/**
 * 🔒 Autorización para gestionar la imagen de perfil de `targetUserId`.
 * Se permite si el solicitante es:
 *   (a) el propio usuario (flujo "Mi perfil"), o
 *   (b) un miembro de la misma compañía y el objetivo también lo es y está ACTIVO
 *       (flujo "Crear/editar usuario", donde un admin gestiona la foto de un colaborador).
 * Evita el IDOR de sobrescribir/borrar la foto de un usuario de OTRA compañía.
 * NOTA: no se puede forzar `targetUserId === req.user.id` porque rompería CreateUser.tsx.
 */
const canManageUserImage = async (targetUserId, req) => {
    const requesterId = req.user?.id;
    const companyId = req.user?.companyId;

    if (!targetUserId || !requesterId) return false;
    if (String(targetUserId) === String(requesterId)) return true; // su propia imagen

    if (!companyId) return false;
    const membership = await user_companies.findOne({
        where: { user_id: targetUserId, company_id: companyId, status: 'active' },
        attributes: ['id']
    });
    return !!membership;
};

module.exports = {

    // Método para eliminar una imagen de perfil de usuario
    async deleteProfileImage(req, res) {
        const { userId, publicId } = req.body;

        try {
            // ✅ PASO 1: Validaciones iniciales
            if (!userId || !publicId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos para realizar la operación'
                });
            }

            // ✅ PASO 2: Verificar que el usuario existe
            const userInDb = await users.findByPk(userId);
            if (!userInDb) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'Usuario no autorizado'
                });
            }

            // 🔒 PASO 2.1: Solo su propia imagen o la de un miembro activo de su compañía
            const authorized = await canManageUserImage(userId, req);
            if (!authorized) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No tiene permiso para eliminar la imagen de este usuario'
                });
            }


            // ✅ PASO 3: Validar que publicId esté presente
            if (!publicId || publicId.trim() === '') {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Falta la llave de eliminacion de la imagen'
                });
            }            

            // 🔒 PASO 4.1: NO confiar en el publicId del cliente. Se usa el guardado en BD
            //    para no permitir borrar un asset arbitrario de Cloudinary (incluso de otra compañía).
            const publicIdToDelete = userInDb.image_public_id;

            // ✅ PASO 5: Iniciar transacción
            const transaction = await sequelize.transaction();

            try {
                // ✅ PASO 6: Actualizar BD PRIMERO (con transacción pendiente)
                await userInDb.update({
                    image_public_id: null,
                    image_url: null
                }, { transaction });

                // Si en BD no hay imagen asociada, no hay nada que borrar en Cloudinary.
                if (!publicIdToDelete) {
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Imagen de perfil eliminada exitosamente',
                        imageUrl: null,
                        imagePublicId: null
                    });
                }

                // ✅ PASO 7: Eliminar de Cloudinary DESPUÉS (con el publicId de la BD)
                const deleteResult = await cloudinary.uploader.destroy(publicIdToDelete);


                // ✅ PASO 8: Evaluar resultado de Cloudinary
                if (deleteResult.result === 'ok') {
                    // Imagen eliminada exitosamente de Cloudinary
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Imagen de perfil eliminada exitosamente',
                        imageUrl: null,
                        imagePublicId: null
                    });
                } else if (deleteResult.result === 'not found') {
                    // Imagen no existía en Cloudinary (está bien, BD ya se actualizó)
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Imagen de perfil eliminada exitosamente',
                        imageUrl: null,
                        imagePublicId: null
                    });
                } else {
                    // Error desconocido en Cloudinary - revertir BD
                    await transaction.rollback();
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar la imagen, por favor intente más tarde'
                    });
                }

            } catch (innerError) {
                await transaction.rollback();
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al eliminar la imagen, por favor intente más tarde'
                });
            }
        } catch (error) {
            console.error('❌ Error general en deleteProfileImage:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al eliminar imagen de perfil',
                details: process.env.NODE_ENV === 'development' ? error.message : null
            });
        }
    },

    // Método para eliminar un logo de empresa
    async deleteCompanyLogoImage(req, res) {
        const { companyId, publicId } = req.body;


        try {
            // ✅ PASO 1: Validaciones iniciales
            if (!companyId || !publicId) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos para realizar la operación'
                });
            }

            // ✅ PASO 2: Verificar que el usuario existe
            const userInDb = await users.findByPk(req.user?.id);
            if (!userInDb) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'Usuario no autorizado'
                });
            }

            // ✅ PASO 3: Verificar que la empresa existe
            const companyInDb = await companies.findByPk(companyId);
            if (!companyInDb) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Empresa no encontrada'
                });
            }

            // ✅ PASO 4: Verificar permisos (usuario debe ser owner de la empresa)
            const userCompanyRelation = await user_companies.findOne({
                where: {
                    user_id: req.user?.id,
                    company_id: companyId,
                    status: 'active'
                }
            });

            if (!userCompanyRelation) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'Accedo denegado para eliminar el logo de esta compañia'
                });
            }

            if (userCompanyRelation.user_type !== 'owner') {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'Solo el propietario puede eliminar el logo de la compañía'
                });
            }

            // ✅ PASO 4: Validar que publicId esté presente
            if (!publicId || publicId.trim() === '') {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Falta la llave de eliminacion de la imagen'
                });
            }

            // 🔒 PASO 4.1: NO confiar en el publicId del cliente; usar el guardado en BD.
            const logoPublicIdToDelete = companyInDb.logo_public_id;

            // ✅ PASO 5: Iniciar transacción
            const transaction = await sequelize.transaction();

            try {
                // ✅ PASO 6: Actualizar BD PRIMERO (con transacción pendiente)
                await companyInDb.update({
                    logo_public_id: null,
                    logo_url: null
                }, { transaction });

                // Si en BD no hay logo asociado, no hay nada que borrar en Cloudinary.
                if (!logoPublicIdToDelete) {
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Logo eliminado exitosamente',
                        logoUrl: null,
                        logoPublicId: null
                    });
                }

                // ✅ PASO 7: Eliminar de Cloudinary DESPUÉS (con el publicId de la BD)
                const deleteResult = await cloudinary.uploader.destroy(logoPublicIdToDelete);

                // ✅ PASO 8: Evaluar resultado de Cloudinary
                if (deleteResult.result === 'ok') {
                    // Imagen eliminada exitosamente de Cloudinary
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Logo eliminado exitosamente',
                        logoUrl: null,
                        logoPublicId: null
                    });
                } else if (deleteResult.result === 'not found') {
                    // Imagen no existía en Cloudinary (está bien, BD ya se actualizó)
                    await transaction.commit();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: 'Logo eliminado exitosamente',
                        logoUrl: null,
                        logoPublicId: null
                    });
                } else {
                    // Error desconocido en Cloudinary - revertir BD
                    await transaction.rollback();
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar la imagen, por favor intente más tarde'
                    });
                }

            } catch (innerError) {
                // Error en BD o Cloudinary - revertir BD
                await transaction.rollback();

                if (innerError.message && innerError.message.includes('Invalid image public ID')) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: 'ID de imagen inválido'
                    });
                }

                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al eliminar la imagen, por favor intente más tarde'
                });
            }

        } catch (error) {
            console.error('❌ Error general en deleteCompanyLogoImage:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al eliminar logo',
                details: process.env.NODE_ENV === 'development' ? error.message : null
            });
        }
    },

    // Metodo para eliminar una imagen de tienda
    async deleteStoreImage(req, res) {
        const { storeId, imageId, publicId, image_url, isPrimary, user } = req.body


        if (!storeId || !imageId || !publicId || !image_url || !user) {

            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Datos incompletos para eliminar la imagen',
                store: null
            });
        }

        const transaction = await sequelize.transaction();

        let cloudinaryDeleted = false;
        let cloudinaryExists = false;

        try {


            // 🔸 PASO 1: Verificar existencia en AMBOS lugares primero

            // 🔒 1.0 La tienda debe pertenecer a la compañía del usuario (evita borrar
            //     imágenes de tiendas de otra compañía — IDOR multi-tenant).
            const storeOwner = await stores.findOne({
                where: { id: storeId, company_id: req.user?.companyId },
                transaction
            });
            if (!storeOwner) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Tienda no encontrada',
                    store: null
                });
            }

            // 1.1 Verificar en Base de Datos (debe pertenecer a la tienda correcta)
            const imageRecord = await store_images.findOne({
                where: {
                    id: imageId,
                    store_id: storeId
                },
                transaction
            });
            const existsInDatabase = !!imageRecord;

            // 🔒 1.1.b Sin registro en BD no se puede verificar la propiedad del asset de
            //     Cloudinary, así que no se borra nada. (Antes se confiaba en el publicId del
            //     cliente y se podía destruir un asset arbitrario, incluso de otra compañía.)
            if (!imageRecord) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La imagen que intenta eliminar NO EXISTE',
                    store: null
                });
            }

            // 🔒 Todas las operaciones en Cloudinary usan el public_id GUARDADO EN BD.
            const dbPublicId = imageRecord.public_id;

            // 1.2 Verificar en Cloudinary

            try {
                const cloudinaryInfo = await cloudinary.api.resource(dbPublicId);
                if (cloudinaryInfo && cloudinaryInfo.public_id) {
                    cloudinaryExists = true;

                }
            } catch (cloudinaryError) {

                if (cloudinaryError.error && cloudinaryError.error.http_code === 404) {
                    cloudinaryExists = false;

                } else {
                    // Si hay error de conectividad, asumimos que existe para intentar eliminarla
                    cloudinaryExists = true;

                }
            }

            // 🔸 PASO 2: Validar que existe en al menos uno de los dos lugares

            if (!existsInDatabase && !cloudinaryExists) {

                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La imagen que intenta eliminar NO EXISTE',
                    store: null
                });
            }

            // 🔸 PASO 3: Eliminar según los casos

            let databaseDeleted = false;

            // CASO 1: Existe en BD y Cloudinary → Eliminar de ambos
            if (existsInDatabase && cloudinaryExists) {


                // Eliminar de BD

                await store_images.destroy({
                    where: { id: imageId },
                    transaction
                });
                databaseDeleted = true;


                // Eliminar de Cloudinary

                try {
                    await cloudinary.uploader.destroy(dbPublicId);
                    cloudinaryDeleted = true;

                } catch (error) {

                    await transaction.rollback();

                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar imagen, por favor intente mas tarde',
                        store: null
                    });
                }

                // Manejar imagen principal si es necesario
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
            }
            // CASO 2: Existe solo en BD → Eliminar solo de BD
            else if (existsInDatabase && !cloudinaryExists) {

                await store_images.destroy({
                    where: { id: imageId },
                    transaction
                });
                databaseDeleted = true;

                // Manejar imagen principal si es necesario
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
            }
            // CASO 3: Existe solo en Cloudinary → Eliminar solo de Cloudinary
            // (Inalcanzable desde el guard de arriba: sin registro en BD ya se devolvió 404.
            //  Se conserva por defensa en profundidad.)
            else if (!existsInDatabase && cloudinaryExists) {

                try {
                    await cloudinary.uploader.destroy(dbPublicId);
                    cloudinaryDeleted = true;

                } catch (error) {

                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar imagen, intente de nuevo',
                        store: null
                    });
                }
            }


            // Recuperar tienda actualizada con estructura consistente
            const updatedStore = await stores.findByPk(storeId, {
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
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

            await transaction.commit();


            return res.status(200).json({
                success: true,
                status: 200,
                message: "Imagen eliminada exitosamente",
                store: storeData
            });

        } catch (error) {


            // 🔸 Solo hacer rollback si la transacción NO ha sido confirmada
            if (!transaction.finished) {

                await transaction.rollback();

            }

            // 🔍 Manejo específico de errores de conectividad
            if (error.message && error.message.includes('ENOTFOUND')) {

                return res.status(503).json({
                    success: false,
                    status: 503,
                    message: 'Problemas de conectividad. La imagen puede haber sido eliminada parcialmente.',
                    error_type: 'CONNECTIVITY_ERROR',
                    store: null
                });
            }

            // Error genérico

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

            // 2. Verificar que la tienda existe y pertenece a la compañía del usuario
            // 🔒 (evita adjuntar imágenes a tiendas de otra compañía — IDOR multi-tenant)
            const store = await stores.findOne({
                where: { id: storeId, company_id: req.user?.companyId }
            });
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



            // 7. Respuesta exitosa
            return res.json(response);

        } catch (error) {

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

    // Método para subir una imagen de logo de empresa a cloudinary y guardar en la base de datos
    async uploadCompanyLogoImage(req, res) {
        const { file, body } = req;
        const { companyId, companyName, aspect, imageType, ownerEmail, currentImagePublicId } = body;
        let cloudinaryResult = null;



        try {
            // ✅ PASO 1: Validaciones iniciales
            if (!file || !file.buffer) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Archivo no válido o faltante'
                });
            }

            const requiredFields = ['companyId', 'companyName', 'aspect', 'imageType', 'ownerEmail'];
            const missingFields = requiredFields.filter(field => !body[field]);
            if (missingFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos',
                    missingFields
                });
            }

            // ✅ PASO 2: Verificar que el usuario existe
            const userInDb = await users.findByPk(req.user?.id);
            if (!userInDb) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'Usuario no autorizado'
                });
            }

            // ✅ PASO 3: Verificar que la empresa existe en BD

            const company = await companies.findByPk(companyId);
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Empresa no encontrada'
                });
            }

            // ✅ PASO 4: Verificar permisos (usuario debe ser owner de la empresa)
            const userCompanyRelation = await user_companies.findOne({
                where: {
                    user_id: req.user?.id,
                    company_id: companyId,
                    status: 'active'
                }
            });

            if (!userCompanyRelation) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No tienes acceso a esta empresa'
                });
            }

            if (userCompanyRelation.user_type !== 'owner') {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'Solo el propietario puede actualizar el logo de la empresa'
                });
            }

            //Permisos verificados: Usuario es owner de la empresa

            // ✅ PASO 5: Eliminar logo anterior si existe.
            // 🔒 Se usa el public_id guardado en BD, no el que envía el cliente.
            const previousLogoPublicId = company.logo_public_id;
            if (previousLogoPublicId) {
                try {
                    const deleteResult = await cloudinary.uploader.destroy(previousLogoPublicId);

                    if (deleteResult.result === 'ok') {

                    }
                } catch (deleteError) {

                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al eliminar el logo anterior, por favor intente de nuevo'
                    });
                }
            }

            // ✅ PASO 6: Optimizar imagen (tamaño estándar para logos)
            const maxWidth = 300;
            const maxHeight = 300;
            const optimizedBuffer = await optimizeImage(file.buffer, maxWidth, maxHeight);

            // ✅ PASO 7: Subir a Cloudinary con estructura organizada
            cloudinaryResult = await uploadToCloudinaryUnified(optimizedBuffer, {
                ownerEmail: ownerEmail,
                companyName: companyName,
                itemName: companyName,
                imageType: imageType || 'company_logo',
                entityType: 'logos',
                tags: [companyName, 'company_logo']
            });

            // ✅ PASO 8: Verificar que la subida a Cloudinary fue exitosa
            if (!cloudinaryResult || !cloudinaryResult.secure_url || !cloudinaryResult.public_id) {
                console.error('❌ Subida a Cloudinary falló - Respuesta incompleta:', cloudinaryResult);
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al subir la imagen, por favor intente de nuevo'
                });
            }

            // ✅ PASO 9: Actualizar la tabla companies en BD
            await company.update({
                logo_url: cloudinaryResult.secure_url,
                logo_public_id: cloudinaryResult.public_id
            });



            // ✅ PASO 10: Respuesta exitosa
            return res.json({
                success: true,
                status: 200,
                message: "Logo de empresa actualizado exitosamente",
                imageUrl: cloudinaryResult.secure_url,
                imagePublicId: cloudinaryResult.public_id
            });

        } catch (error) {

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
        const { userId, userName, userEmail, companyName, aspect, imageType, ownerEmail, currentImagePublicId } = body;
        let cloudinaryResult = null;

        console.log("subiendo imagen de perfil de usuario...")

        try {
            // 1. Validaciones iniciales
            if (!file || !file.buffer) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Archivo no válido o faltante'
                });
            }

            const requiredFields = ['userId', 'userName', 'userEmail', 'companyName', 'aspect'];
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
            const user = await users.findByPk(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Usuario no encontrado'
                });
            }

            // 🔒 2.1 Solo su propia imagen o la de un miembro activo de su compañía
            const authorizedUpload = await canManageUserImage(userId, req);
            if (!authorizedUpload) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No tiene permiso para modificar la imagen de este usuario'
                });
            }

            // 3. Eliminar imagen anterior si existe.
            // 🔒 Se usa SIEMPRE el public_id guardado en BD, no el que envía el cliente
            //    (evita destruir un asset arbitrario de Cloudinary).
            const previousPublicId = user.image_public_id;
            if (previousPublicId) {
                try {
                    const deleteResult = await cloudinary.uploader.destroy(previousPublicId);

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
// Estructura: FabriApp/{environment}/ownerEmail/companyName/{entityType}
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

    // 🌍 DETECTAR ENTORNO AUTOMÁTICAMENTE
    const environment = process.env.NODE_ENV || 'development';
    const envPrefix = environment === 'production' ? 'prod' : 'dev';


    // �📁 ESTRUCTURA DE CARPETAS CON SEPARACIÓN DE ENTORNOS:
    // FabriApp/dev/ownerEmail/companyName/{entityType} (desarrollo)
    // FabriApp/prod/ownerEmail/companyName/{entityType} (producción)
    const folderPath = `FabriApp/${envPrefix}/${ownerEmail}/${companyName}/${entityType}`;

    // Generar public_id único: itemName_imageType_timestamp_hash
    const timestamp = Date.now();
    const hash = Math.random().toString(36).substring(2, 8);
    const publicId = `${normalizeForFileName(itemName)}_${imageType}_${timestamp}_${hash}`;

    // 🏷️ TAGS CON INFORMACIÓN DE ENTORNO
    const baseTags = [
        'fabriapp',
        entityType.slice(0, -1),
        imageType,
        normalizeForFileName(companyName),
        environment,  // 'development' o 'production'
        envPrefix     // 'dev' o 'prod'
    ];
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
            company: companyName,
            environment: environment,           // ✨ Contexto de entorno
            app_version: process.env.APP_VERSION || '1.0.0',
            deployed_at: new Date().toISOString()
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


    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    reject(error);
                } else {

                    resolve(result);
                }
            }
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(uploadStream);
    });
}


