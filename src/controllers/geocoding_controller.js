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

            console.log('🔧 [GEOCODING BACKEND] API Key configurada correctamente');
            console.log('🔧 [GEOCODING BACKEND] Coordenadas:', { lat, lng });

            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=es&region=CO`;

            const response = await fetch(url);
            const data = await response.json();

            console.log('🔧 [GEOCODING BACKEND] Google API Status:', data.status);            if (data.status === "OK" && data.results.length > 0) {
                const address = data.results[0].formatted_address;
                const parts = address.split(",").map(item => item.trim());

                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: 'Dirección encontrada exitosamente',
                    address: address,
                    fullAddress: address, // Mantener compatibilidad
                    parts: {
                        address: parts[0] || '',
                        city: parts[1] || '',
                        state: parts[2] || '',
                        country: parts[3] || ''
                    }
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



