const { stores } = require('../models');

module.exports = {

    // 📌 Método para crear una tienda
    async createStore(req, res) {
        console.log("📌 Intentando crear una tienda...");

        try {
            // Extraer los campos obligatorios del cuerpo de la petición
            let { name, address, store_type_id, neighborhood } = req.body;

            // Validar que los campos obligatorios estén presentes
            if (!name || !address || !store_type_id || !neighborhood) {
                return res.status(400).json({ error: "Faltan datos obligatorios." });
            }

            // Aplicar transformación al nombre: eliminar espacios, reemplazar múltiples espacios por uno y convertir a mayúsculas
            if (name) {
                name = name.trim().replace(/\s+/g, ' ').toUpperCase();
            }

            // Aplicar transformación al barrio: eliminar espacios, reemplazar múltiples espacios por uno y poner la primera letra de cada palabra en mayúscula
            if (neighborhood) {
                neighborhood = neighborhood
                    .trim()
                    .replace(/\s+/g, ' ')
                    .split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
            }

            // Actualizar req.body con los valores procesados
            req.body.name = name;
            req.body.neighborhood = neighborhood;

            // Verificar si ya existe una tienda con el mismo nombre y barrio
            const existingStore = await stores.findOne({ where: { name, neighborhood } });
            if (existingStore) {
                return res.status(400).json({ error: "Esta tienda ya existe." });
            }

            // Crear la tienda con los datos proporcionados
            const newStore = await stores.create(req.body);

            // Obtener la tienda creada con sus relaciones completas (store_type y manager)           
            const createdStore = await stores.findOne({
                where: { id: newStore.id },
                attributes: [
                    'id',
                    'name',
                    'address',
                    'phone',
                    'neighborhood',
                    'route_id',
                    'image_url',
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
                    }
                ]
            });

            // Devolver la tienda creada con sus relaciones
            return res.status(201).json(createdStore);
        } catch (error) {
            console.error("❌ Error al crear tienda:", error);
            return res.status(500).json({ error: "Error al crear tienda." });
        }
    },
}