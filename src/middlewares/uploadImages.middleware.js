const multer = require('multer');

// Configuración para trabajar con buffers en memoria
const storage = multer.memoryStorage(); // ← Esto es clave

const fileFilter = (req, file, cb) => {
    // Validar tipos de archivo (opcional pero recomendado)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no soportado'), false);
    }
};

const upload = multer({
    storage: storage, // memoryStorage en lugar de diskStorage
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: fileFilter // Filtro opcional
});

module.exports = upload;