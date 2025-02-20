const { or } = require('sequelize');
const { supplier_companies } = require('../models');

module.exports = {

    //Metodo para crear un nuevo proveedor
    async createSupplier(req, res) {
        console.log("📌 Intentando registrar un nuevo proveedor...", req.body);

        try {
            // Extraer los datos correctamente
            const { name, contact_info, address, phone } = req.body; // 🔹 Usa "address"

            // Validar los datos requeridos
            if (!name || !contact_info || !address || !phone) {
                return res.status(400).json({ error: "Faltan datos para registrar proveedor" });
            }

            console.log("📌 Creando proveedor:", name, contact_info, address, phone);

            // Insertar en la base de datos
            const newSupplier = await supplier_companies.create({
                name,
                contact_info,
                address, // 🔹 Aquí también debe ser "address"
                phone
            });

            console.log("✅ Proveedor registrado con éxito:", newSupplier);
            res.status(201).json(newSupplier);
        } catch (error) {
            console.error("❌ Error al registrar el proveedor:", error);
            if (error.name === "SequelizeUniqueConstraintError") {
                return res.status(400).json({ error: "El proveedor ya existe." });
            }
            res.status(500).json({ error: "Error al registrar el proveedor." });
        }
    },


    //Metodo para obtener todos los proveedores
    async getAllSuppliers(req, res) {
        console.log("📌 Intentando obtener todos los proveedores...");

        try {
            // Buscar todos los proveedores
            const suppliers = await supplier_companies.findAll({
                order: [['name', 'ASC']],
            });

            console.log("✅ Proveedores encontrados:", suppliers);
            res.status(200).json(suppliers);
        } catch (error) {
            console.error("❌ Error al obtener los proveedores:", error);
            res.status(500).json({ error: "Error al obtener los proveedores." });
        }
    },
};
