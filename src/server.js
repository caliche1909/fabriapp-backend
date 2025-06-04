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
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear FormData


// Ruta de prueba
app.get('/', (req, res) => {
    res.send(`API funcionando en el puerto ${process.env.PORT} 🚀`);
});

//Registrar las rutas
app.use('/api/users', userRoutes);
app.use('/api/measurement_units', measurementUnitsRoutes);
app.use('/api/supplier_companies', supplierCompaniesRoutes);
app.use('/api/inventory_supplies', inventorySuppliesRoutes);
app.use('/api/inventory_supplies_balance', inventorySuppliesBalanceRoutes);
app.use('/api/supplies_stock', suppliesStockRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/store_types', storeTypeRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/upload_images', uploadImagesRoutes);
app.use('/api/register-company-and-user', registerCompanyAndUserRoutes);

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

