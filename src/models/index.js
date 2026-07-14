'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');

// 🔧 Cargar variables de entorno solo si no están ya cargadas
if (!process.env.JWT_SECRET && fs.existsSync(path.join(__dirname, '../../.env'))) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
}

const basename = path.basename(__filename);

// 🌍 Detectar entorno automáticamente
let env = process.env.NODE_ENV;

// Si no está definido, detectar por otras variables
if (!env) {
  if (process.env.DATABASE_URL) {
    env = 'production';
  } else {
    env = 'development';
  }
}

console.log(`🌍 Entorno detectado: ${env}`);

const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
if (config.use_env_variable && process.env[config.use_env_variable]) {
  // 🚀 PRODUCCIÓN: Usar DATABASE_URL de Cloud Run
  console.log('📡 Conectando a base de datos usando DATABASE_URL...');
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else if (env === 'production' && process.env.DB_HOST) {
  // 🚀 PRODUCCIÓN: Usar variables individuales si no hay DATABASE_URL
  console.log('📡 Conectando a base de datos usando variables individuales...');
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: config.dialect,
    dialectOptions: config.dialectOptions,
  });
} else {
  // 🛠️ DESARROLLO: Usar configuración del config.json
  console.log(`🔧 Conectando a base de datos local: ${config.host}:${config.port || 5432}/${config.database}`);
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
