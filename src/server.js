require('dotenv').config();
const express = require('express');
const cors = require('cors');

//importacion de rutas 
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const measurementUnitsRoutes = require('./routes/measurementUnitsRoutes');
const supplierCompaniesRoutes = require('./routes/supplierCompaniesRouter');
const inventorySuppliesRoutes = require('./routes/inventorySupplierRoute');
const inventorySuppliesBalanceRoutes = require('./routes/inventorySuppliesBalanceRoutes');
const suppliesStockRoutes = require('./routes/suppliesStockRoutes');
const routesRoutes = require('./routes/routesRoutes');
const routeTypesRoutes = require('./routes/route_types.routes');
const storeTypeRoutes = require('./routes/storeTypesRoutes');
const storesRoutes = require('./routes/storesRoutes');
const uploadImagesRoutes = require('./routes/uploadImagesRoutes');
const registerCompanyAndUserRoutes = require('./routes/registerCompanyAndUserRoutes');
const companyRoutes = require('./routes/companyRoutes');
const userGeolocationRoutes = require('./routes/userGeolocationRoutes');
const rolesRoutes = require('./routes/rolesRoutes');
const modulesRoutes = require('./routes/modulesRoutes');
const geocodingRoutes = require('./routes/geocodingRoutes');
const storeNoSaleReportsRoutes = require('./routes/store_no_sale_reports_routes');
const noSaleCategoriesRoutes = require('./routes/no_sale_categories_routes');
const paymetMethodsRoutes = require('./routes/paymetMethodsRoutes');
const salesRoutes = require('./routes/sales_routes');
const http = require('http');
const initSockets = require('./sockets');

const app = express();

// Middleware CORS configurado para múltiples entornos
const corsOptions = {
    origin: function (origin, callback) {
        // Permitir peticiones sin origin (aplicaciones móviles, Postman, etc.)
        if (!origin) return callback(null, true);

        // Orígenes de desarrollo: el client arranca por defecto en 5174, pero
        // si está ocupado hace fallback a 5175, 5176, ... (hasta 5183). Se
        // permiten desde el 5173 para cubrir también arranques manuales en ese
        // puerto y que CORS no bloquee al client en ningún puerto alternativo.
        const devOrigins = Array.from({ length: 12 }, (_, i) => `http://localhost:${5173 + i}`);

        const allowedOrigins = [
            ...devOrigins,                      // localhost:5173 .. 5182 (dev + fallback)
            'https://www.fabriapp.com',        // Producción principal
            'https://fabriapp.com',            // Producción sin www
            process.env.FRONTEND_URL,          // URL desde variable de entorno
            process.env.FRONTEND_URL_PRODUCTION // URL de producción desde env
        ].filter(Boolean); // Remover valores undefined/null

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn('🚫 CORS: Origen no permitido:', origin);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true, // Permitir cookies y headers de autenticación
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear FormData


// Ruta de prueba
app.get('/', (req, res) => {
    res.send(`API funcionando en el puerto ${process.env.PORT} 🚀`);
});

// Health check endpoint para Docker/Kubernetes
app.get('/health', (req, res) => {
    const healthcheck = {
        uptime: process.uptime(),
        message: 'OK',
        timestamp: Date.now(),
        env: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000
    };

    try {
        res.status(200).json(healthcheck);
    } catch (error) {
        healthcheck.message = error;
        res.status(503).json(healthcheck);
    }
});

// Readiness check - más completo (opcional para Kubernetes)
app.get('/ready', (req, res) => {
    // Aquí podrías agregar verificaciones adicionales si necesitas
    // como conexión a base de datos, servicios externos, etc.
    const readiness = {
        status: 'ready',
        timestamp: Date.now(),
        checks: {
            server: 'ok',
            // database: 'ok',  // Agregar cuando implementes verificación de DB
            // redis: 'ok',     // Agregar si usas Redis, etc.
        }
    };

    res.status(200).json(readiness);
});

//Registrar las rutas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/measurement_units', measurementUnitsRoutes);
app.use('/api/supplier_companies', supplierCompaniesRoutes);
app.use('/api/supplies', inventorySuppliesRoutes);
app.use('/api/balance_inventory_supplies', inventorySuppliesBalanceRoutes);
app.use('/api/supplies_stock', suppliesStockRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/route-types', routeTypesRoutes);
app.use('/api/store_types', storeTypeRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/upload_images', uploadImagesRoutes);
app.use('/api/register-company-and-user', registerCompanyAndUserRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/users/geolocation', userGeolocationRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/modules', modulesRoutes);
app.use('/api/geocoding', geocodingRoutes);
app.use('/api/store_no_sale_reports', storeNoSaleReportsRoutes);
app.use('/api/no_sale_categories', noSaleCategoriesRoutes);
app.use('/api/payment_methods', paymetMethodsRoutes);
app.use('/api/sales', salesRoutes);


// Puerto del servidor: intenta el puerto por defecto y, si está ocupado
// (EADDRINUSE), prueba los siguientes de forma consecutiva hasta encontrar
// uno libre. La búsqueda está acotada por MAX_PORT_ATTEMPTS para no quedarse
// buscando indefinidamente.
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 10; // límite de búsqueda: DEFAULT_PORT .. DEFAULT_PORT+9

const httpServer = http.createServer(app);

// Inicializar Socket.IO
initSockets(httpServer);

let currentPort = DEFAULT_PORT;
let portAttempts = 0;

httpServer.on('listening', () => {
    // Sincroniza process.env.PORT con el puerto realmente usado para que las
    // rutas que lo reportan (`/`, `/health`) muestren el valor correcto.
    process.env.PORT = String(currentPort);
    if (currentPort !== DEFAULT_PORT) {
        console.warn(`⚠️  El puerto ${DEFAULT_PORT} estaba ocupado. Se arrancó en el puerto ${currentPort}.`);
    }
    console.log(`✅ API y WebSocket corriendo en http://localhost:${currentPort}`);
});

httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        portAttempts++;
        if (portAttempts >= MAX_PORT_ATTEMPTS) {
            console.error(`❌ No se encontró un puerto libre entre ${DEFAULT_PORT} y ${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1}. Abortando.`);
            process.exit(1);
        }
        console.warn(`🚫 Puerto ${currentPort} en uso. Probando el ${currentPort + 1}...`);
        currentPort++;
        setTimeout(() => httpServer.listen(currentPort), 100);
    } else {
        // Cualquier otro error de arranque es real: propágalo.
        throw err;
    }
});

httpServer.listen(currentPort);

