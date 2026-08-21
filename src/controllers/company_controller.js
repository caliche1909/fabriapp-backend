const { companies, users, user_companies } = require('../models');

module.exports = {

    // 📌 METODO PARA ESTABLECER LA COMPAÑÍA PREDETERMINADA DEL USUARIO (uso interno/auto-set)
    // ⚠️ El "predeterminado" vive en user_companies.is_default (por-usuario), NO en companies.
    //    (companies no tiene columna is_default). Usa el método setAsDefault() que resetea las
    //    demás compañías del usuario de forma transaccional. Sin contraseña: es el auto-set inicial.
    async updateIsDefaultTrue(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            // Verificar que la compañía existe
            const company = await companies.findByPk(id);

            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Compañía no encontrada'
                });
            }

            // Verificar que la compañía está activa
            if (!company.is_active) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'No se puede establecer como predeterminada una compañía inactiva'
                });
            }

            // 🔒 Validar que el usuario pertenece (activo) a la compañía (evita IDOR multi-tenant)
            const membership = await user_companies.findOne({
                where: { user_id: userId, company_id: id, status: 'active' }
            });

            if (!membership) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No perteneces a esta compañía'
                });
            }

            // ✅ Marcarla como predeterminada del usuario (resetea las demás, transaccional)
            await membership.setAsDefault();

            res.status(200).json({
                success: true,
                status: 200,
                message: `La compañía ${company.name} esta operando`,
            });

        } catch (error) {
            console.error('❌ Error al actualizar is_default:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al actualizar la compañía predeterminada',
                error: error.message
            });
        }
    },

    // 📌 CAMBIO MANUAL DE COMPAÑÍA PREDETERMINADA — requiere CONTRASEÑA del usuario.
    //    Flujo: el usuario elige otra compañía en el selector → confirma con su contraseña →
    //    validamos identidad + membresía → la marcamos como predeterminada. El frontend luego
    //    hace logout y redirige a login para recargar la app limpia con la nueva compañía.
    async switchDefaultCompany(req, res) {
        try {
            const { id } = req.params;        // compañía destino
            const userId = req.user?.id;      // usuario autenticado (del token)
            const { password } = req.body;

            if (!password) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'La contraseña es requerida'
                });
            }

            // 🔐 Validar identidad con la contraseña del usuario autenticado
            const user = await users.findByPk(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Usuario no encontrado'
                });
            }

            const isValidPassword = await user.validatePassword(password);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    status: 401,
                    message: 'Contraseña incorrecta'
                });
            }

            // Verificar que la compañía destino existe y está activa
            const company = await companies.findByPk(id);
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Compañía no encontrada'
                });
            }
            if (!company.is_active) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'No se puede seleccionar una compañía inactiva'
                });
            }

            // 🔒 Validar que el usuario pertenece (activo) a la compañía destino (evita IDOR)
            const membership = await user_companies.findOne({
                where: { user_id: userId, company_id: id, status: 'active' }
            });
            if (!membership) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No perteneces a esta compañía o tu vínculo no está activo'
                });
            }

            // ✅ Marcarla como predeterminada del usuario (resetea las demás, transaccional)
            await membership.setAsDefault();

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Compañía predeterminada actualizada. Vuelve a iniciar sesión.'
            });

        } catch (error) {
            console.error('❌ Error al cambiar de compañía predeterminada:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al cambiar de compañía',
                error: error.message
            });
        }
    },

    // 📌 METODO PARA ACTUALIZAR UNA EMPRESA
    async updateCompanyById(req, res) {
        try {
            const { id } = req.params;
            const companyId = req.user?.companyId; // 🔒 compañía activa del usuario autenticado
            const {
                name,
                legalName,
                taxId,
                email,
                phone,
                address,
                city,
                state,
                country,
                postalCode,
                neighborhood,
                website,
                logoUrl,
                timezone,
                latitude,
                longitude
            } = req.body;

            // 🔒 Solo se puede editar la propia compañía activa (evita IDOR multi-tenant:
            // checkPermission valida el permiso, no la pertenencia del recurso).
            if (id !== companyId) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: 'No tiene permiso para modificar esta compañía'
                });
            }

            // Verificar que la compañía existe
            const company = await companies.findByPk(id);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Compañía no encontrada'
                });
            }

            // Validar la zona horaria si viene: debe ser un identificador IANA válido.
            // Intl.DateTimeFormat lanza RangeError si la zona no existe.
            if (timezone !== undefined && timezone !== null && timezone !== '') {
                try {
                    Intl.DateTimeFormat('en-US', { timeZone: timezone });
                } catch (tzError) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: `La zona horaria "${timezone}" no es válida`
                    });
                }
            }

            // Preparar los datos para actualizar
            const updateData = {
                // Campos requeridos: usar valor anterior si viene vacío/null/undefined
                name: name || company.name,
                legal_name: legalName || company.legal_name,
                
                // Campos opcionales: convertir strings vacíos a NULL para la base de datos
                tax_id: taxId !== undefined ? (taxId === '' ? null : taxId) : company.tax_id,
                email: email !== undefined ? (email === '' ? null : email) : company.email,
                phone: phone !== undefined ? (phone === '' ? null : phone) : company.phone,
                address: address !== undefined ? (address === '' ? null : address) : company.address,
                city: city !== undefined ? (city === '' ? null : city) : company.city,
                state: state !== undefined ? (state === '' ? null : state) : company.state,
                country: country !== undefined ? (country === '' ? null : country) : company.country,
                postal_code: postalCode !== undefined ? (postalCode === '' ? null : postalCode) : company.postal_code,
                neighborhood: neighborhood !== undefined ? (neighborhood === '' ? null : neighborhood) : company.neighborhood,
                website: website !== undefined ? (website === '' ? null : website) : company.website,
                logo_url: logoUrl !== undefined ? (logoUrl === '' ? null : logoUrl) : company.logo_url,

                // Zona horaria: campo obligatorio en BD; si viene vacío/nulo, conservar el valor anterior.
                timezone: (timezone !== undefined && timezone !== null && timezone !== '') ? timezone : company.timezone,
            };

            // Si se proporcionaron coordenadas, actualizar la ubicación
            if (latitude !== undefined && longitude !== undefined) {
                const sequelize = companies.sequelize;
                updateData.ubicacion = sequelize.fn('ST_SetSRID', 
                    sequelize.fn('ST_MakePoint', longitude, latitude), 
                    4326
                );
            }

            // Actualizar la compañía
            await company.update(updateData);

            // Obtener la compañía actualizada con las coordenadas calculadas
            const updatedCompany = await companies.findByPk(id, {
                attributes: {
                    include: [
                        [companies.sequelize.fn('ST_Y', companies.sequelize.col('ubicacion')), 'latitude'],
                        [companies.sequelize.fn('ST_X', companies.sequelize.col('ubicacion')), 'longitude']
                    ]
                }
            });
           

            // Procesar coordenadas PostGIS - pueden ser null si no hay ubicación
            const responseLatitude = updatedCompany.dataValues?.latitude 
                ? parseFloat(updatedCompany.dataValues.latitude) 
                : null;
            const responseLongitude = updatedCompany.dataValues?.longitude 
                ? parseFloat(updatedCompany.dataValues.longitude) 
                : null;

            //obtener el codigo de pais
            let countryCodeP = null;
            let phoneP = null;

            if(updatedCompany.phone !== null && 
                updatedCompany.phone !== undefined && 
                updatedCompany.phone !== '' &&
                updatedCompany.phone.includes('-')
            ){
                countryCodeP = updatedCompany.phone.split('-')[0];
                phoneP = updatedCompany.phone.split('-')[1];
            }
            //preparar la respuesta
            const newCompany = {
                id: updatedCompany.id,
                name: updatedCompany.name,
                legalName: updatedCompany.legal_name,
                taxId: updatedCompany.tax_id,
                email: updatedCompany.email,
                countryCode: countryCodeP,
                phone: phoneP,
                address: updatedCompany.address,
                city: updatedCompany.city,
                state: updatedCompany.state,
                country: updatedCompany.country,
                postalCode: updatedCompany.postal_code,
                neighborhood: updatedCompany.neighborhood,
                website: updatedCompany.website,
                logoUrl: updatedCompany.logo_url,
                timezone: updatedCompany.timezone,
                // Solo lectura aquí: el modo se cambia en Configuraciones, no en "Mi compañía".
                // Se devuelve para que el payload de la compañía sea completo y coherente.
                salesInventoryMode: updatedCompany.sales_inventory_mode,
                latitude: responseLatitude,
                longitude: responseLongitude,
            }

            res.status(200).json({
                success: true,
                status: 200,
                message: `Compañía ${updatedCompany.name} actualizada exitosamente`,
                company: newCompany
            });

        } catch (error) {
            console.error('❌ Error al actualizar compañía:', error);
            res.status(500).json({ 
                success: false,
                status: 500,
                message: 'Error interno del servidor al actualizar la compañía',
                error: error.message 
            });
        }
    }
};