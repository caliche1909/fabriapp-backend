// Configuración de la base de datos para Sequelize (ORM y sequelize-cli).
// Las credenciales se leen de variables de entorno; NO se hardcodean aquí.
// Cargamos server/.env si aún no está cargado (necesario cuando lo invoca
// sequelize-cli de forma aislada; el runtime de la app también lo tolera).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = 5432,
  DB_NAME = 'fabriapp',
  DB_USER = 'postgres',
  DB_PASSWORD,
} = process.env;

module.exports = {
  development: {
    username: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'postgres',
  },
  test: {
    username: DB_USER,
    password: DB_PASSWORD,
    database: process.env.DB_NAME_TEST || DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'postgres',
  },
  // Producción: las credenciales vienen de las variables de entorno del
  // entorno (Cloud Run / Secret Manager), que son distintas a las de dev.
  production: {
    username: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};
