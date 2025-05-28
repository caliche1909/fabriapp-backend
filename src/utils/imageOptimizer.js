const sharp = require('sharp');

async function optimizeImage(buffer, maxWidth, maxHeight) {
    try {
        // Obtener metadata original
        const { width: originalWidth, height: originalHeight, format: originalFormat } = await sharp(buffer).metadata();


        // Lógica para determinar dimensiones cuando son null (aspecto 'free')
        let targetWidth = maxWidth;
        let targetHeight = maxHeight;

        if (!maxWidth && !maxHeight) {
            const aspectRatio = originalWidth / originalHeight;

            // Umbrales para determinar tipo de imagen
            const isHorizontal = aspectRatio > 1.2;  // Rectangular horizontal (banners)
            const isVertical = aspectRatio < 0.8;    // Rectangular vertical (retratos)

            if (isHorizontal) {
                // Para imágenes horizontales (banners)
                const MAX_WIDTH = 1200;
                targetWidth = Math.min(originalWidth, MAX_WIDTH);
                targetHeight = Math.round(targetWidth / aspectRatio);
            }
            else if (isVertical) {
                // Para imágenes verticales
                const MAX_HEIGHT = 1600;
                targetHeight = Math.min(originalHeight, MAX_HEIGHT);
                targetWidth = Math.round(targetHeight * aspectRatio);
            }
            else {
                // Para imágenes aproximadamente cuadradas
                const MAX_SIZE = 800;
                if (originalWidth > MAX_SIZE || originalHeight > MAX_SIZE) {
                    const scale = Math.min(MAX_SIZE / originalWidth, MAX_SIZE / originalHeight);
                    targetWidth = Math.round(originalWidth * scale);
                    targetHeight = Math.round(originalHeight * scale);
                } else {
                    // No redimensionar si es más pequeña que el máximo
                    targetWidth = originalWidth;
                    targetHeight = originalHeight;
                }
            }
        }

        // Procesar imagen
        let image = sharp(buffer);

        if (targetWidth || targetHeight) {
            image = image.resize({
                width: targetWidth,
                height: targetHeight,
                fit: 'cover',
                withoutEnlargement: true // No agrandar imágenes más pequeñas
            });
        }

        // Ajustar calidad según tipo de imagen
        const quality = originalWidth > 1200 || originalHeight > 1200 ? 70 : 80;

        // Optimizar y convertir a buffer
        const optimizedBuffer = await image
            .toFormat('webp', {
                quality: quality,
                effort: 6,
                alphaQuality: 80 // Calidad para transparencias
            })
            .toBuffer();

        // Obtener metadata después de procesar
        await sharp(optimizedBuffer).metadata();



        return optimizedBuffer;
    } catch (error) {
        console.error('❌ Error al optimizar:', error);
        throw error;
    }
}

module.exports = { optimizeImage };