const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Función para obtener fecha y hora formateada
function getCurrentDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// Función para cargar variables de entorno desde archivo .env
function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');  // server/.env
    console.log(`🔍 Buscando archivo .env en: ${envPath}`);
    
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {  // Ignorar líneas vacías y comentarios
                const equalIndex = line.indexOf('=');
                if (equalIndex > 0) {
                    const key = line.substring(0, equalIndex).trim();
                    let value = line.substring(equalIndex + 1).trim();
                    
                    // Remover comillas simples o dobles al inicio y final
                    if ((value.startsWith("'") && value.endsWith("'")) || 
                        (value.startsWith('"') && value.endsWith('"'))) {
                        value = value.slice(1, -1);
                    }
                    
                    process.env[key] = value;
                }
            }
        });
        console.log('✅ Variables de entorno cargadas desde .env');
    } else {
        console.log('⚠️ Archivo .env no encontrado, usando variables del sistema');
        console.log(`   Ruta buscada: ${envPath}`);
    }
}

// La configuración se definirá DESPUÉS de cargar las variables de entorno
let dbConfig;

// Función para configurar la base de datos DESPUÉS de cargar las variables
function configureDatabase() {
    dbConfig = {
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432
    };
}

// Función para encontrar la ruta de pg_dump
function findPgDumpPath() {
    const possiblePaths = [
        'pg_dump', // En PATH
        '"C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"',
        '"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe"',
        '"C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_dump.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe"',
    ];

    return possiblePaths;
}

// Validar que las credenciales estén configuradas
function validateConfig() {
    if (!dbConfig.password) {
        console.error('\n❌ ERROR: Credenciales de base de datos no configuradas');
        console.error('\n🔧 ASEGÚRATE QUE TU ARCHIVO .env TENGA:');
        console.error("   DB_USER='postgres'");
        console.error("   DB_PASSWORD='tu_password#123'  # ← Usa comillas simples si termina en #");
        console.error("   DB_NAME='fabriapp'");
        console.error("   DB_HOST='127.0.0.1'");
        console.error('   DB_PORT=5432');
        process.exit(1);
    }
}

async function createDatabaseBackup() {
    console.log('\n🔄 INICIANDO BACKUP COMPLETO DE LA BASE DE DATOS...\n');

    try {
        // Cargar variables de entorno, configurar BD y validar
        loadEnvFile();
        configureDatabase();
        validateConfig();
        // Crear carpeta de backup con timestamp
        const timestamp = getCurrentDateTime();
        const backupDir = path.join(__dirname, '..', '..', '..', 'backup_database', `backup_${timestamp}`);

        // Crear directorios si no existen
        if (!fs.existsSync(path.dirname(backupDir))) {
            fs.mkdirSync(path.dirname(backupDir), { recursive: true });
        }
        fs.mkdirSync(backupDir, { recursive: true });

        console.log(`📁 Carpeta de backup creada: ${backupDir}\n`);

        // Nombre del archivo de backup
        const backupFileName = `fabriapp_backup_${timestamp}.sql`;
        const backupFilePath = path.join(backupDir, backupFileName);

        // Encontrar pg_dump disponible
        const pgDumpPaths = findPgDumpPath();
        let workingPgDump = null;

        console.log('🔍 Buscando pg_dump disponible...\n');

        for (const pgDumpPath of pgDumpPaths) {
            try {
                await new Promise((resolve, reject) => {
                    exec(`${pgDumpPath} --version`, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            console.log(`✅ Encontrado: ${pgDumpPath} - ${stdout.trim()}`);
                            workingPgDump = pgDumpPath;
                            resolve(stdout);
                        }
                    });
                });
                break; // Si encontramos uno que funciona, salimos del bucle
            } catch (error) {
                console.log(`❌ No disponible: ${pgDumpPath}`);
                continue;
            }
        }

        if (!workingPgDump) {
            throw new Error('No se encontró pg_dump en el sistema. Verifica que PostgreSQL esté instalado correctamente.');
        }

        // Backup del esquema completo (estructura + datos + funciones + triggers)
        const fullBackupCommand = `${workingPgDump} -h ${dbConfig.host} -U ${dbConfig.username} -d ${dbConfig.database} -p ${dbConfig.port} --clean --create --if-exists --no-owner --no-privileges --verbose > "${backupFilePath}"`;

        console.log('\n🔄 Ejecutando backup completo de la base de datos...\n');
        console.log(`Comando: ${fullBackupCommand}\n`);

        // Configurar variable de entorno para la contraseña
        const env = { ...process.env, PGPASSWORD: dbConfig.password };

        return new Promise((resolve, reject) => {
            exec(fullBackupCommand, { env }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Error al crear el backup:', error);
                    reject(error);
                    return;
                }

                if (stderr) {
                    console.log('📄 Información del proceso:', stderr);
                }

                // Verificar que el archivo se creó correctamente
                if (fs.existsSync(backupFilePath)) {
                    const stats = fs.statSync(backupFilePath);

                    console.log('✅ BACKUP COMPLETADO EXITOSAMENTE!\n');
                    console.log('=== INFORMACIÓN DEL BACKUP ===');
                    console.log(`📁 Carpeta: ${backupDir}`);
                    console.log(`📄 Archivo: ${backupFileName}`);
                    console.log(`📊 Tamaño: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    console.log(`⏰ Fecha de creación: ${new Date().toLocaleString('es-CO')}`);

                    // Crear archivo de información del backup
                    const infoContent = `BACKUP DE BASE DE DATOS - fabriapp
====================================

Fecha de backup: ${new Date().toLocaleString('es-CO')}
Base de datos: ${dbConfig.database}
Host: ${dbConfig.host}
Puerto: ${dbConfig.port}
Usuario: ${dbConfig.username}
Herramienta usada: ${workingPgDump}

CONTENIDO DEL BACKUP:
- Todas las tablas con su estructura
- Todos los datos de las tablas
- Todos los índices
- Todas las funciones
- Todos los triggers
- Todas las secuencias
- Todas las vistas
- Todos los tipos de datos personalizados

CÓMO RESTAURAR:
1. Crear una nueva base de datos vacía:
   createdb -U ${dbConfig.username} -h ${dbConfig.host} nombre_nueva_db

2. Restaurar el backup:
   psql -U ${dbConfig.username} -h ${dbConfig.host} -d nombre_nueva_db < "${backupFileName}"

O para reemplazar la base de datos existente:
   psql -U ${dbConfig.username} -h ${dbConfig.host} < "${backupFileName}"

NOTA: El archivo de backup incluye comandos DROP y CREATE,
por lo que puede usarse para restaurar completamente la base de datos.
`;

                    fs.writeFileSync(path.join(backupDir, 'README_RESTAURACION.txt'), infoContent);

                    console.log('\n📋 Archivo de instrucciones creado: README_RESTAURACION.txt');
                    console.log('\n🎉 El backup incluye:');
                    console.log('   ✅ Estructura completa de todas las tablas');
                    console.log('   ✅ Todos los datos');
                    console.log('   ✅ Índices y restricciones');
                    console.log('   ✅ Funciones y procedimientos');
                    console.log('   ✅ Triggers');
                    console.log('   ✅ Secuencias');
                    console.log('   ✅ Vistas');
                    console.log('   ✅ Tipos de datos personalizados');

                    resolve(backupFilePath);
                } else {
                    const error = new Error('El archivo de backup no se creó correctamente');
                    console.error('❌', error.message);
                    reject(error);
                }
            });
        });

    } catch (error) {
        console.error('\n❌ Error general en el proceso de backup:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

// Función para verificar que pg_dump está disponible (simplificada)
function checkPgDumpAvailability() {
    console.log('🔍 Verificando disponibilidad de pg_dump...\n');
    return Promise.resolve(true); // Ahora la verificación se hace en createDatabaseBackup
}

// Función principal
async function main() {
    try {
        console.log('🚀 SISTEMA DE BACKUP AUTOMÁTICO DE BASE DE DATOS');
        console.log('================================================\n');

        // Verificar disponibilidad de pg_dump
        await checkPgDumpAvailability();

        // Crear el backup
        const backupPath = await createDatabaseBackup();

        console.log('\n🎯 BACKUP FINALIZADO CORRECTAMENTE');
        console.log(`📍 Ubicación: ${backupPath}`);
        console.log('\n💡 Para restaurar este backup, consulta el archivo README_RESTAURACION.txt');

    } catch (error) {
        console.error('\n❌ ERROR EN EL PROCESO DE BACKUP:', error.message);
        process.exit(1);
    }
}

// Ejecutar el backup
main();
