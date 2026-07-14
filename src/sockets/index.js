const { Server } = require('socket.io');
const authMiddleware = require('./auth');
const rateLimiter = require('./rateLimit');
const registerUserPositionHandler = require('./handlers/userPosition.handler');

module.exports = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: function (origin, callback) {
                // Permitir peticiones sin origin (aplicaciones móviles, etc.)
                if (!origin) return callback(null, true);
                
                // Orígenes de desarrollo: el client arranca por defecto en 5174,
                // pero puede hacer fallback a 5175, 5176, ... Se permiten desde el
                // 5173 para no bloquear el WebSocket en ningún puerto alternativo.
                const devOrigins = Array.from({ length: 12 }, (_, i) => `http://localhost:${5173 + i}`);

                const allowedOrigins = [
                    ...devOrigins,                      // localhost:5173 .. 5184 (dev + fallback)
                    'https://www.fabriapp.com',        // Producción principal
                    'https://fabriapp.com',            // Producción sin www
                    process.env.FRONTEND_URL,          // URL desde variable de entorno
                    process.env.FRONTEND_URL_PRODUCTION // URL de producción desde env
                ].filter(Boolean);
                
                if (allowedOrigins.indexOf(origin) !== -1) {
                    callback(null, true);
                } else {
                    console.warn('🚫 WebSocket CORS: Origen no permitido:', origin);
                    callback(new Error('No permitido por CORS'));
                }
            },
            methods: ["GET", "POST"],
            credentials: true
        },
        path: '/api/socket.io', // ✅ Bajo el paraguas de /api
        allowEIO3: true
    });

    // Middleware global de autenticación
    io.use(authMiddleware);

    // Conexión de clientes
    io.on('connection', (socket) => {
        console.log(`✅ Cliente WebSocket conectado - Usuario: ${socket.userId}`);
        
        // Unir al room de su compañía
        if (socket.companyId) {
            socket.join(`company_${socket.companyId}`);
        }

        // Rate-limit por socket
        socket.use(rateLimiter);

        // Registrar handlers de dominio
        registerUserPositionHandler(io, socket);

        // Log de desconexión
        socket.on('disconnect', (reason) => {
            console.log(`❌ Cliente WebSocket desconectado - Usuario: ${socket.userId}, Razón: ${reason}`);
        });
    });

    // Log de errores críticos
    io.engine.on('connection_error', (err) => {
        console.error('🚨 Error crítico en WebSocket:', err.message);
    });

    return io;
};
