const { inventory_supplies, measurement_units, supplier_companies } = require('../models');
const { Sequelize } = require('sequelize');

module.exports = {


    // 📌(Verificado 1.1) Método para obtener todos los insumos de una compañía
    async getListOfInventorySupplies(req, res) {
        console.log("📌 Intentando obtener todos los insumos de una compañía...", req.params);

        try {
            const { company_id } = req.params;

            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Se requiere el ID de la compañía",
                    supplies: []
                });
            }

            // 🔹 Obtener todos los insumos de la compañía directamente
            const supplies = await inventory_supplies.findAll({
                where: {
                    company_id: company_id
                },
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ],
                order: [['name', 'ASC']] // Ordenar alfabéticamente
            });

            // 🔹 Verificar si se encontraron insumos
            if (supplies.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "No se encontraron insumos para esta compañía",
                    supplies: []
                });
            }

            // 🔹 Formatear cada insumo con estructura optimizada para tabla
            const formattedSupplies = supplies.map(supply => ({
                id: supply.id,
                name: supply.name,
                packaging_type: supply.packaging_type,
                packaging_weight: supply.packaging_weight,
                packaging_unit: supply.packaging_unit,
                packaging_price: supply.packaging_price,
                portions: supply.portions,
                portion_unit: supply.portion_unit,
                portion_price: supply.portion_price,
                total_quantity_gr_ml_und: supply.total_quantity_gr_ml_und,
                unit_price: supply.unit_price,
                supplier: supply.supplier ? {
                    id: supply.supplier.id,
                    name: supply.supplier.name,
                    address: supply.supplier.address,
                    phone: supply.supplier.phone,
                    email: supply.supplier.email,
                    logo_url: supply.supplier.logo_url,
                    verification: supply.supplier.verification,
                    verification_count: supply.supplier.verification_count,
                    has_social_media: supply.supplier.hasSocialMedia(),
                    social_media: supply.supplier.getSocialMedia(),
                } : null,
                description: supply.description,
                minimum_stock: supply.minimum_stock,
                last_purchase_date: supply.last_purchase_date
            }));

            console.log("✅ Insumos obtenidos:", formattedSupplies.length);
            res.status(200).json({
                success: true,
                message: "Insumos obtenidos exitosamente",
                supplies: formattedSupplies
            });

        } catch (error) {
            console.error("❌ Error al obtener los insumos:", error);
            res.status(500).json({
                success: false,
                message: "Error al obtener los insumos",
                supplies: [],
                total_count: 0
            });
        }
    },

    // 📌(Verificado 1.1) Método para crear un nuevo insumo
    async createInventorySupply(req, res) {
        console.log("📌 Intentando registrar un nuevo insumo...", req.body);

        try {
            // Extraer los datos del cuerpo de la solicitud
            let {
                company_id,
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
            name = name.trim().replace(/\s+/g, " ").toUpperCase();

            // 🔹 Validar datos obligatorios
            if (!company_id || !name || !packaging_type || !packaging_weight || !packaging_unit_id || !packaging_price || !unit_price
                || !portions || !portion_unit_id || !portion_price || !total_quantity_gr_ml_und || !supplier_id || minimum_stock <= 0 || minimum_stock === undefined) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos obligatorios para registrar el insumo"
                });
            }

            // 🔹 Verificar que el proveedor existe
            const supplierExists = await supplier_companies.findByPk(supplier_id);
            if (!supplierExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El proveedor especificado no existe"
                });
            }

            // 🔹 Crear el insumo directamente
            const newSupply = await inventory_supplies.create({
                company_id,
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

            // 🔹 Obtener el insumo completo con sus asociaciones
            const supply = await inventory_supplies.findByPk(newSupply.id, {
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ]
            });

            // 🔹 Respuesta simplificada
            res.status(201).json({
                success: true,
                message: "Insumo registrado exitosamente",
                supply: {
                    id: supply.id,
                    name: supply.name,
                    packaging_type: supply.packaging_type,
                    packaging_weight: supply.packaging_weight,
                    packaging_unit: supply.packaging_unit,
                    packaging_price: supply.packaging_price,
                    portions: supply.portions,
                    portion_unit: supply.portion_unit,
                    portion_price: supply.portion_price,
                    total_quantity_gr_ml_und: supply.total_quantity_gr_ml_und,
                    unit_price: supply.unit_price,
                    supplier: supply.supplier ? {
                        id: supply.supplier.id,
                        name: supply.supplier.name,
                        address: supply.supplier.address,
                        phone: supply.supplier.phone,
                        email: supply.supplier.email,
                        logo_url: supply.supplier.logo_url,
                        verification: supply.supplier.verification,
                        verification_count: supply.supplier.verification_count,
                        has_social_media: supply.supplier.hasSocialMedia(),
                        social_media: supply.supplier.getSocialMedia(),
                    } : null,
                    description: supply.description,
                    minimum_stock: supply.minimum_stock,
                    last_purchase_date: supply.last_purchase_date
                }
            });

        } catch (error) {
            console.error("❌ Error al registrar el insumo:", error);

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error! No se pudo registrar el insumo."
            });
        }
    },

    // 📌(Verificado 1.1) Método para actualizar un insumo por ID
    async updateInventorySupply(req, res) {
        console.log("📌 Intentando actualizar un insumo por ID...", req.body);

        try {
            const {
                company_id,
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

            // Extraer el id del insumo a actualizar desde los parámetros de la URL
            const { id } = req.params;

            // 🔹 Validar datos obligatorios
            if (!company_id || !name || !packaging_type || !packaging_weight || !packaging_unit_id || !packaging_price || !unit_price
                || !portions || !portion_unit_id || !portion_price || !total_quantity_gr_ml_und || !supplier_id || minimum_stock <= 0 || minimum_stock === undefined) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos obligatorios para actualizar el insumo"
                });
            }

            // 🔹 Buscar el insumo a actualizar en la base de datos
            const supplyDB = await inventory_supplies.findByPk(id);
            if (!supplyDB) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "El insumo que intentas actualizar NO EXISTE!"
                });
            }

            // 🔹 Normalizar el nuevo nombre
            const normalizedName = name.trim().replace(/\s+/g, " ").toUpperCase();

            // 🔹 Verificar que el proveedor existe
            const supplierExists = await supplier_companies.findByPk(supplier_id);
            if (!supplierExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El proveedor especificado no existe"
                });
            }

            // 🔹 Actualizar el insumo directamente
            const updatedFields = {
                name: normalizedName,
                packaging_type: packaging_type,
                packaging_weight: packaging_weight,
                packaging_unit_id: packaging_unit_id,
                packaging_price: packaging_price,
                portions: portions,
                portion_unit_id: portion_unit_id,
                portion_price: portion_price,
                total_quantity_gr_ml_und: total_quantity_gr_ml_und,
                unit_price: unit_price,
                supplier_id: supplier_id,
                description: description,
                minimum_stock: minimum_stock
            };

            await inventory_supplies.update(updatedFields, { where: { id } });

            // 🔹 Obtener el insumo actualizado con sus asociaciones
            const updatedSupply = await inventory_supplies.findByPk(id, {
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ]
            });

            // 🔹 Respuesta consistente con createInventorySupply y getListOfInventorySupplies
            res.status(200).json({
                success: true,
                message: "Insumo actualizado exitosamente",
                supply: {
                    id: updatedSupply.id,
                    name: updatedSupply.name,
                    packaging_type: updatedSupply.packaging_type,
                    packaging_weight: updatedSupply.packaging_weight,
                    packaging_unit: updatedSupply.packaging_unit,
                    packaging_price: updatedSupply.packaging_price,
                    portions: updatedSupply.portions,
                    portion_unit: updatedSupply.portion_unit,
                    portion_price: updatedSupply.portion_price,
                    total_quantity_gr_ml_und: updatedSupply.total_quantity_gr_ml_und,
                    unit_price: updatedSupply.unit_price,
                    supplier: updatedSupply.supplier ? {
                        id: updatedSupply.supplier.id,
                        name: updatedSupply.supplier.name,
                        address: updatedSupply.supplier.address,
                        phone: updatedSupply.supplier.phone,
                        email: updatedSupply.supplier.email,
                        logo_url: updatedSupply.supplier.logo_url,
                        verification: updatedSupply.supplier.verification,
                        verification_count: updatedSupply.supplier.verification_count,
                        has_social_media: updatedSupply.supplier.hasSocialMedia(),
                        social_media: updatedSupply.supplier.getSocialMedia(),
                    } : null,
                    description: updatedSupply.description,
                    minimum_stock: updatedSupply.minimum_stock,
                    last_purchase_date: updatedSupply.last_purchase_date
                }
            });

        } catch (error) {
            console.error("❌ Error al actualizar el insumo:", error);

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error! No se pudo actualizar el insumo."
            });
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
                return res.status(404).json({ 
                    success: false,
                    status: 404,
                    message: "Este insumo ya NO EXISTE!" 
                });
            }

            // 🔹 Eliminar el insumo de la base de datos
            await inventory_supplies.destroy({ where: { id } });

            console.log("✅ Insumo eliminado con éxito:", supplyDB);
            res.status(200).json({ 
                success: true,
                status: 200,
                message: "Insumo eliminado con éxito" 
            });

        } catch (error) {
            console.error("❌ Error al eliminar el insumo:", error);
            res.status(500).json({ error: "Error al eliminar el insumo." });
        }
    },



    /**_______________________________________________SIN USAR__________________________________________________________ */
   
    // 📌 Método para obtener un insumo por ID
    async getInventorySupplyById(req, res) {
        console.log("📌 Intentando obtener insumo por ID:", req.params.id);

        try {
            const { id } = req.params;

            // 🔹 Buscar el insumo con todas sus asociaciones
            const supply = await inventory_supplies.findByPk(id, {
                include: [
                    { model: measurement_units, as: 'packaging_unit' },
                    { model: measurement_units, as: 'portion_unit' },
                    { model: supplier_companies, as: 'supplier' }
                ]
            });

            if (!supply) {
                return res.status(404).json({
                    success: false,
                    message: "El insumo no existe",
                    supply: null
                });
            }

            // 🔹 Respuesta con información completa del insumo
            res.status(200).json({
                success: true,
                message: "Insumo obtenido exitosamente",
                supply: {
                    id: supply.id,
                    name: supply.name,
                    packaging_type: supply.packaging_type,
                    packaging_weight: supply.packaging_weight,
                    packaging_unit: supply.packaging_unit,
                    packaging_price: supply.packaging_price,
                    portions: supply.portions,
                    portion_unit: supply.portion_unit,
                    portion_price: supply.portion_price,
                    total_quantity_gr_ml_und: supply.total_quantity_gr_ml_und,
                    unit_price: supply.unit_price,
                    supplier: supply.supplier ? {
                        id: supply.supplier.id,
                        name: supply.supplier.name,
                        email: supply.supplier.email,
                        phone: supply.supplier.phone,
                        address: supply.supplier.address,
                        city: supply.supplier.city,
                        state: supply.supplier.state,
                        country: supply.supplier.country,
                        description: supply.supplier.description,
                        verification: supply.supplier.verification,
                        verification_count: supply.supplier.verification_count,
                        logo_url: supply.supplier.logo_url,
                        social_media: supply.supplier.getSocialMedia(),
                        has_social_media: supply.supplier.hasSocialMedia()
                    } : null,
                    description: supply.description,
                    minimum_stock: supply.minimum_stock,
                    last_purchase_date: supply.last_purchase_date
                }
            });

        } catch (error) {
            console.error("❌ Error al obtener el insumo:", error);
            res.status(500).json({
                success: false,
                message: "Error al obtener el insumo",
                supply: null
            });
        }
    },

};

