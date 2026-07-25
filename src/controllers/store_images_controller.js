// controllers/storeImageController.js
const { stores, store_images } = require('../models');

module.exports = {
    // Método para crear y devolver todas las imágenes actualizadas
    async createStoreImage(storeId, imageData) {
        try {
            // 1. Obtener tienda con sus imágenes en una sola consulta
            const store = await stores.findByPk(storeId);

            if(!store){
                return {
                    success: false,
                    status: 404,
                    message: 'Tienda no encontrada',
                    store: null
                }
            }

            // 3. Crear la nueva imagen
            await store_images.create({
                store_id: storeId,
                ...imageData,
                is_primary: true
            });

            const updatedStore = await stores.findByPk(storeId, {
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'company_id', // ✅ Incluir company_id para consistencia
                    // 🗺️ Extraer coordenadas del campo PostGIS ubicacion (igual que otros controladores)
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
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status'],                        
                    },                    
                    {
                        association: 'images',
                        as: 'images',
                        attributes: ['id', 'image_url', 'public_id', 'is_primary']
                    }
                ]
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

            return {
                success: true,
                status: 200,
                message: "Imagen subida exitosamente",
                store: storeData
            };

        } catch (error) {
            console.error("❌ Error al crear imagen de tienda:", error);
            throw error;
        }
    }
}