const { or } = require('sequelize');
const { supplier_companies, inventory_supplies } = require('../models');

// Función auxiliar para generar enlace de WhatsApp desde teléfono
const generateWhatsAppLink = (phone) => {
    if (!phone) return null;

    // Limpiar el número: remover guiones, espacios, paréntesis
    const cleanPhone = phone.replace(/[-\s()]/g, '');

    // Generar enlace de WhatsApp
    return `https://wa.me/${cleanPhone}`;
};

module.exports = {

    //Método para crear un nuevo proveedor
    async createSupplier(req, res) {

        try {
            // Extraer los datos del cuerpo de la petición
            const {
                name,
                email,
                phone,
                address,
                city,
                state,
                country,
                description,
                company_id,
                // Nuevos campos opcionales
                logo_url,
                website,
                facebook_url,
                instagram_url,
                x_url,
                linkedin_url,
                tiktok_url,
                youtube_url
            } = req.body;

            // Extraer información del usuario autenticado (debe venir del middleware de autenticación)
            const user_id = req.user?.id;

            // Generar enlace de WhatsApp automáticamente desde el teléfono
            const whatsappLink = generateWhatsAppLink(phone);

            // Validar datos requeridos del proveedor
            if (!name || !company_id || !user_id || !phone || !email) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Faltan datos obligatorios",
                    supplier: null
                });
            }
            // 🔹 Verificar duplicados antes de crear
            const duplicateChecks = [];
            const normalizedName = name.trim().replace(/\s+/g, " ");


            const nameExists = await supplier_companies.findOne({
                where: { name: normalizedName }
            });
            if (nameExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre del proveedor ya existe",
                    supplier: null
                });
            }


            // Verificar email duplicado (solo si se proporciona)
            const normalizedEmail = email.trim().toLowerCase();
            const emailExists = await supplier_companies.findOne({
                where: { email: normalizedEmail }
            });
            if (emailExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El email del proveedor ya esta en uso",
                    supplier: null
                });
            }


            // Verificar teléfono duplicado (solo si se proporciona)
            const normalizedPhone = phone.trim();
            const phoneExists = await supplier_companies.findOne({
                where: { phone: normalizedPhone }
            });
            if (phoneExists) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El teléfono del proveedor ya esta en uso",
                    supplier: null
                });
            }


            // Crear el proveedor con información de ownership
            const newSupplier = await supplier_companies.create({
                // Información básica del proveedor
                name: normalizedName,
                email: normalizedEmail,
                phone: normalizedPhone,
                address: address || null,
                city: city || null,
                state: state || null,
                country: country || null,
                description: description || null,

                // Información digital y redes sociales
                logo_url: logo_url || null,
                website: website || null,
                facebook_url: facebook_url || null,
                instagram_url: instagram_url || null,
                x_url: x_url || null,
                linkedin_url: linkedin_url || null,
                tiktok_url: tiktok_url || null,
                youtube_url: youtube_url || null,
                whatsapp_url: whatsappLink, // Enlace generado automáticamente

                // Información de ownership y auditoría
                created_by_company_id: company_id,
                created_by_user_id: user_id,
                last_updated_by_user_id: user_id

                // Los siguientes campos se establecen automáticamente:
                // verification: 'pending' (por defecto)
                // verification_count: 0 (por defecto)
                // created_at: CURRENT_TIMESTAMP
                // updated_at: CURRENT_TIMESTAMP
            });

            // Respuesta exitosa simplificada
            return res.status(201).json({
                success: true,
                status: 201,
                message: "Proveedor registrado exitosamente",
                supplier: {
                    // Campos básicos
                    id: newSupplier.id,
                    name: newSupplier.name,
                    email: newSupplier.email,
                    phone: newSupplier.phone,
                    address: newSupplier.address,
                    city: newSupplier.city,
                    state: newSupplier.state,
                    country: newSupplier.country,
                    description: newSupplier.description,
                    verification: newSupplier.verification,
                    verification_count: newSupplier.verification_count,

                    // Solo logo (website va en social_media)
                    logo_url: newSupplier.logo_url,

                    // Redes sociales organizadas
                    social_media: newSupplier.getSocialMedia(),
                    has_social_media: newSupplier.hasSocialMedia()
                }
            });

        } catch (error) {
            console.error("❌ Error al registrar el proveedor:", error);

            // Manejar errores específicos de Sequelize
            if (error.name === "SequelizeUniqueConstraintError") {
                const field = error.errors[0]?.path;
                let message = "El proveedor ya existe";

                if (field === 'name') {
                    message = "EL nombre del proveedor ya existe";
                } else if (field === 'email') {
                    message = "El email del proveedor ya existe";
                } else if (field === 'phone') {
                    message = "El teléfono del proveedor ya existe";
                }

                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: message,
                    supplier: null
                });
            }

            if (error.name === "SequelizeValidationError") {
                const validationErrors = error.errors.map(err => ({
                    field: err.path,
                    message: err.message
                }));

                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Errores de validación en los datos del proveedor",
                    supplier: null,
                    details: validationErrors
                });
            }

            // Error genérico
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno al registrar el proveedor",
                supplier: null,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    //Método para obtener todos los proveedores
    async getAllSuppliers(req, res) {
        
        try {
            // Buscar todos los proveedores
            const suppliers = await supplier_companies.findAll({
                order: [['name', 'ASC']],
            });

            // Formatear cada proveedor con estructura simplificada
            const formattedSuppliers = suppliers.map(supplier => ({
                // Campos básicos
                id: supplier.id,
                name: supplier.name,
                email: supplier.email,
                phone: supplier.phone,
                address: supplier.address,
                city: supplier.city,
                state: supplier.state,
                country: supplier.country,
                description: supplier.description,
                verification: supplier.verification,
                verification_count: supplier.verification_count,

                // Solo logo (website va en social_media)
                logo_url: supplier.logo_url,

                // Redes sociales organizadas
                social_media: supplier.getSocialMedia(),
                has_social_media: supplier.hasSocialMedia()
            }));

            return res.status(200).json({
                success: true,
                status: 200,
                message: "Proveedores obtenidos exitosamente",
                suppliers: formattedSuppliers
            });

        } catch (error) {
            console.error("❌ Error al obtener los proveedores:", error);

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno al obtener los proveedores",
                suppliers: [],
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

};
