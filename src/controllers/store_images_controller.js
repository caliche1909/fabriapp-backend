// controllers/storeImageController.js
const { stores, store_images } = require('../models');

module.exports = {
    // Método para crear y devolver todas las imágenes actualizadas
    async createStoreImage(storeId, imageData) {
        try {
            // 1. Obtener tienda con sus imágenes en una sola consulta
            const store = await stores.findByPk(storeId);

            if (!store) {
                throw new Error('STORE_NOT_FOUND');
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
                ]
            });

            return {
                success: true,
                store: updatedStore.get({ plain: true })
            };

        } catch (error) {
            console.error("❌ Error al crear imagen de tienda:", error);
            throw error;
        }
    }
}