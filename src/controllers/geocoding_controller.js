// Extrae de address_components de Google el primer componente cuyo `types`
// contenga alguno de los tipos pedidos. Devuelve long_name o '' si no existe.
const getComponent = (components, types) => {
    const match = components.find(c => types.some(t => c.types.includes(t)));
    return match ? match.long_name : '';
};

// Consulta la zona horaria IANA (ej. 'America/Bogota') para unas coordenadas
// usando la Google Time Zone API. No es crítica: si falla, devuelve null y el
// flujo de geocodificación continúa igual.
const fetchTimezone = async (lat, lng, apiKey) => {
    try {
        // La API exige un timestamp (para resolver horario de verano); el momento actual sirve.
        const timestamp = Math.floor(Date.now() / 1000);
        const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === 'OK' && data.timeZoneId) {
            return data.timeZoneId;
        }
        console.warn('⚠️ [TIMEZONE] Google Time Zone API status:', data.status, data.errorMessage || '');
        return null;
    } catch (error) {
        console.error('❌ [TIMEZONE] Error consultando Time Zone API:', error.message);
        return null;
    }
};

module.exports = {

    async reverseGeocoding(req, res) {
        try {
            const { lat, lng } = req.body;

            if (!lat || !lng) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Latitud y longitud son requeridas',
                    error: 'Parámetros faltantes'
                });
            }

            // Obtener API Key desde variable de entorno (montada desde Secret Manager en Cloud Run)
            if (!process.env.GOOGLE_MAPS_API_KEY) {
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Configuración del servidor incompleta',
                    error: 'API Key no configurada'
                });
            }

            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=es&region=CO`;

            const response = await fetch(url);
            const data = await response.json();

            console.log('🔧 [GEOCODING BACKEND] Google API Status:', data.status);

            if (data.status === "OK" && data.results.length > 0) {
                const result = data.results[0];
                const address = result.formatted_address;
                const components = result.address_components || [];

                // Parseo robusto desde address_components (mejor que partir la cadena por comas).
                const route = getComponent(components, ['route']);
                const streetNumber = getComponent(components, ['street_number']);
                const street = [route, streetNumber].filter(Boolean).join(' ').trim();

                const parts = {
                    // Dirección de calle; si no hay route, caer al primer fragmento de la dirección formateada.
                    address: street || address.split(',')[0].trim(),
                    neighborhood: getComponent(components, ['neighborhood', 'sublocality', 'sublocality_level_1']),
                    city: getComponent(components, ['locality', 'administrative_area_level_2']),
                    state: getComponent(components, ['administrative_area_level_1']),
                    country: getComponent(components, ['country']),
                    postalCode: getComponent(components, ['postal_code'])
                };

                // Zona horaria de la ubicación (llamada aparte a la Time Zone API; no crítica).
                const timezone = await fetchTimezone(lat, lng, apiKey);

                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: 'Dirección encontrada exitosamente',
                    address: address,
                    fullAddress: address, // Mantener compatibilidad
                    parts,
                    timezone // IANA (ej. 'America/Bogota') o null si no se pudo resolver
                });
            } else {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'No se encontró dirección para estas coordenadas',
                    error: data.error_message || 'Dirección no encontrada',
                    googleStatus: data.status,
                    googleError: data.error_message
                });
            }

        } catch (error) {
            console.error('❌ Error en reverse geocoding:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor',
                error: error.message || 'Error desconocido'
            });
        }
    }
};
