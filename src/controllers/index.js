const userController = require('./userController');
const measurement_unitsController = require('./measurement_units_controller');
const supplierController = require('./supplier_companies_controller');
const inventory_suppliesController = require('./inventory_supplies_controller');
const inventory_supplies_balanceController = require('./inventory_supplies_balance_controller');
const supplies_stockController = require('./supplies_stock_controller');
const routesController = require('./routes_controller');
const store_typesController = require('./store_types_controller');
const storesController = require('./stores_controller');
const upload_store_imageController = require('./image_upload_controller');
const store_imagesController = require('./store_images_controller');

module.exports = {
    userController,
    measurement_unitsController,
    supplierController,
    inventory_suppliesController,
    inventory_supplies_balanceController,
    supplies_stockController,
    routesController,
    store_typesController,
    storesController,
    upload_store_imageController,
    store_imagesController
};
