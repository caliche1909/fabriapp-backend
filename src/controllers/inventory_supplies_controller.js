const { inventory_supplies, measurement_units, supplier_companies } = require('../models');

module.exports = {

    // 📌 Método para crear un nuevo insumo
    async createInventorySupply(req, res) {
        console.log("📌 Intentando registrar un nuevo insumo...", req.body);

        try {
            // Extraer los datos del cuerpo de la solicitud
            let {
                name,
                packaging_type,
                packaging_weight,
                packaging_unit_id,
                packaging_price,
                portions,
                portion_unit_id,
                portion_price,
                total_quantity_gr_ml_und,
                unit_price,
                supplier_id,
                description,
                minimum_stock
            } = req.body;

            // 🔹 Normalizar el nombre del insumo
            name = name.trim().replace(/\s+/g, " ").toUpperCase(); // Mayúsculas y eliminación de espacios extra

            // 🔹 Validar datos obligatorios
            if (!name || !packaging_type || !packaging_weight || !packaging_unit_id || !packaging_price || !unit_price
                || !portions || !portion_unit_id || !portion_price || !total_quantity_gr_ml_und || !supplier_id || minimum_stock <= 0 || minimum_stock === undefined) {
                return res.status(400).json({ error: "Faltan datos obligatorios para registrar el insumo" });
            }

            console.log("📌 Validando si el insumo ya existe:", name);

            // 🔹 Verificar si el insumo ya existe
            const existingSupply = await inventory_supplies.findOne({ where: { name } });
            if (existingSupply) {
                return res.status(400).json({ error: "El insumo que intentas registrar YA EXISTE!" });
            }

            console.log("📌 Creando insumo con los siguientes datos:", {
                name, packaging_type, packaging_weight, packaging_unit_id,
                packaging_price, portions, portion_unit_id, portion_price,
                total_quantity_gr_ml_und, unit_price, supplier_id, description, minimum_stock
            });

            // 🔹 Insertar en la base de datos
            const newSupply = await inventory_supplies.create({
                name,
                packaging_type,
                packaging_weight,
                packaging_unit_id,
                packaging_price,
                portions,
                portion_unit_id,
                portion_price,
                total_quantity_gr_ml_und,
                unit_price,
                supplier_id,
                description, 
                minimum_stock
            });

            // 🔹 Obtener el objeto completo con las asociaciones
            const fullSupply = await inventory_supplies.findByPk(newSupply.id, {
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ]
            })

            console.log("✅ Insumo registrado con éxito:", fullSupply);
            res.status(201).json(fullSupply);

        } catch (error) {
            console.error("❌ Error al registrar el insumo:", error);

            // 🔹 Capturar error de restricción UNIQUE
            if (error instanceof Sequelize.UniqueConstraintError) {
                return res.status(400).json({ error: "El insumo que intentas registrar, YA EXISTE!" });
            }

            res.status(500).json({ error: "Error al registrar el insumo." });
        }
    },

    // 📌 Método para obtener todos los insumos
    async getAllInventorySupplies(req, res) {
        console.log("📌 Intentando obtener todos los insumos...");

        try {
            const supplies = await inventory_supplies.findAll({
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ],
                order: [['name', 'ASC']], // Ordenar alfabéticamente
            });

            console.log("✅ Insumos obtenidos:------------------------------------------------------------------------------------------------", supplies);
            res.status(200).json(supplies);
        } catch (error) {
            console.error("❌ Error al obtener los insumos:", error);
            res.status(500).json({ error: "Error al obtener los insumos." });
        }
    },

    // 📌 Método para actualizar un insumo por ID
    async updateInventorySupply(req, res) {
        console.log("📌 Intentando actualizar un insumo por ID...", req.body);

        try {
            // Extraer el id del insumo a actualizar desde los parámetros de la URL
            const { id } = req.params;

            // 🔹 Buscar el insumo a actualizar en la base de datos
            const supplyDB = await inventory_supplies.findByPk(id);
            if (!supplyDB) {
                return res.status(404).json({ error: "El insumo que intentas actualizar NO EXISTE!" });
            }

            // 🔹 Normalizar el nuevo nombre para evitar diferencias por espacios o mayúsculas/minúsculas
            const newName = req.body.name?.trim().replace(/\s+/g, " ").toUpperCase();

            // 🔹 Verificar si el nombre ya existe en otro insumo diferente al que se está editando
            if (newName && newName !== supplyDB.name) {
                const existingSupply = await inventory_supplies.findOne({
                    where: { name: newName }
                });

                if (existingSupply) {
                    return res.status(400).json({ error: "Ya existe un insumo con este nombre!" });
                }
            }

            // 🔹 Preparar el objeto con los valores actualizados o mantener los valores existentes si están vacíos
            const updatedFields = {
                name: newName || supplyDB.name,
                packaging_type: req.body.packaging_type ?? supplyDB.packaging_type,
                packaging_weight: req.body.packaging_weight ?? supplyDB.packaging_weight,
                packaging_unit_id: req.body.packaging_unit_id ?? supplyDB.packaging_unit_id,
                packaging_price: req.body.packaging_price ?? supplyDB.packaging_price,
                portions: req.body.portions ?? supplyDB.portions,
                portion_unit_id: req.body.portion_unit_id ?? supplyDB.portion_unit_id,
                portion_price: req.body.portion_price ?? supplyDB.portion_price,
                total_quantity_gr_ml_und: req.body.total_quantity_gr_ml_und ?? supplyDB.total_quantity_gr_ml_und,
                unit_price: req.body.unit_price ?? supplyDB.unit_price,
                supplier_id: req.body.supplier_id ?? supplyDB.supplier_id,
                description: req.body.description ?? supplyDB.description,
                minimum_stock: req.body.minimum_stock ?? supplyDB.minimum_stock
            };

            // 🔹 Actualizar en la base de datos
            await inventory_supplies.update(updatedFields, { where: { id } });

            // 🔹 Obtener el objeto actualizado de la base de datos
            // 🔹 Obtener el objeto actualizado de la base de datos con el proveedor incluido
            const updatedSupply = await inventory_supplies.findByPk(id, {
                include: [
                    {
                        model: supplier_companies,
                        as: "supplier", // Debe coincidir con el alias en la asociación del modelo
                    },
                    {
                        model: measurement_units,
                        as: 'packaging_unit'
                    },
                    {
                        model: measurement_units,
                        as: 'portion_unit'
                    },
                ],
            });


            console.log("✅ Insumo actualizado con éxito:", updatedSupply);
            res.status(200).json(updatedSupply);

        } catch (error) {
            console.error("❌ Error al actualizar el insumo:", error);
            res.status(500).json({ error: "Error al actualizar el insumo." });
        }
    },

    // 📌 Método para eliminar un insumo por ID
    async deleteInventorySupply(req, res) {
        console.log("📌 Intentando eliminar un insumo por ID...", req.params.id);

        try {
            // Extraer el id del insumo desde los parámetros de la URL
            const { id } = req.params;

            // 🔹 Buscar el insumo a eliminar en la base de datos
            const supplyDB = await inventory_supplies.findByPk(id);
            if (!supplyDB) {
                return res.status(404).json({ error: "Este insumo ya NO EXISTE!" });
            }

            // 🔹 Eliminar el insumo de la base de datos
            await inventory_supplies.destroy({ where: { id } });

            console.log("✅ Insumo eliminado con éxito:", supplyDB);
            res.status(200).json({ message: "Insumo eliminado con éxito" });

        } catch (error) {
            console.error("❌ Error al eliminar el insumo:", error);
            res.status(500).json({ error: "Error al eliminar el insumo." });
        }
    }

};

