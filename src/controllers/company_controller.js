const { companies } = require('../models');

module.exports = {

    // 📌 METODO PARA ACTUALIZAR EL IS_DEFAULT DE LA EMPRESA A TRUE
    async updateIsDefaultTrue(req, res) {
        try {
            const { id } = req.params;
            
            console.log(`📌 Intentando establecer compañía ${id} como predeterminada...`);

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

            // Actualizar is_default a true (el trigger se encargará del resto)
            await company.update({ is_default: true });            

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

    // 📌 METODO PARA ACTUALIZAR UNA EMPRESA
    async updateCompanyById(req, res) {
        try {
            const { id } = req.params;
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
                latitude,
                longitude
            } = req.body;

            console.log(`📝 Intentando actualizar compañía ${id}...`);

            // Verificar que la compañía existe
            const company = await companies.findByPk(id);
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Compañía no encontrada'
                });
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

            console.log(`✅ Compañía ${updatedCompany.name} actualizada exitosamente`);

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