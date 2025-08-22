require('dotenv').config();
const express = require('express');
const cors = require('cors');

//immportacion de rutas 
const userRoutes = require('./routes/userRoutes');
const measurementUnitsRoutes = require('./routes/measurementUnitsRoutes');
const supplierCompaniesRoutes = require('./routes/supplierCompaniesRouter');
const inventorySuppliesRoutes = require('./routes/inventorySupplierRoute');
const inventorySuppliesBalanceRoutes = require('./routes/inventorySuppliesBalanceRoutes');
const suppliesStockRoutes = require('./routes/suppliesStockRoutes');
const routesRoutes = require('./routes/routesRoutes');
const storeTypeRoutes = require('./routes/storeTypesRoutes');
const storesRoutes = require('./routes/storesRoutes');
const uploadImagesRoutes = require('./routes/uploadImagesRoutes');
const registerCompanyAndUserRoutes = require('./routes/registerCompanyAndUserRoutes');
const companyRoutes = require('./routes/companyRoutes');
const userGeolocationRoutes = require('./routes/userGeolocationRoutes');
const rolesRoutes = require('./routes/rolesRoutes');
const modulesRoutes = require('./routes/modulesRoutes');
const http = require('http');
const initSockets = require('./sockets');

const app = express();

// Middleware
app.use(cors());
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
app.use('/api/users', userRoutes);
app.use('/api/measurement_units', measurementUnitsRoutes);
app.use('/api/supplier_companies', supplierCompaniesRoutes);
app.use('/api/supplies', inventorySuppliesRoutes);
app.use('/api/balance_inventory_supplies', inventorySuppliesBalanceRoutes);
app.use('/api/supplies_stock', suppliesStockRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/store_types', storeTypeRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/upload_images', uploadImagesRoutes);
app.use('/api/register-company-and-user', registerCompanyAndUserRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/users/geolocation', userGeolocationRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/modules', modulesRoutes);

// Puerto del servidor
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);

// Inicializar Socket.IO
initSockets(httpServer);

httpServer.listen(PORT, () => {
    console.log(`API y WebSocket corriendo en http://localhost:${PORT}`);
});

