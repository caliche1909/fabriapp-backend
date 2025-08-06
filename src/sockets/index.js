const { Server } = require('socket.io');
const authMiddleware = require('./auth');
const rateLimiter = require('./rateLimit');
const registerUserPositionHandler = require('./handlers/userPosition.handler');

module.exports = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        path: '/ws',
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
