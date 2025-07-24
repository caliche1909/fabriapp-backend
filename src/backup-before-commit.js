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

// Función para obtener el último commit
function getLastCommitInfo() {
    return new Promise((resolve, reject) => {
        exec('git log -1 --pretty=format:"%h_%s"', (error, stdout, stderr) => {
            if (error) {
                console.log('⚠️ No se pudo obtener info de git, usando timestamp simple');
                resolve('manual');
            } else {
                // Limpiar caracteres especiales para nombre de archivo
                const cleaned = stdout.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
                resolve(cleaned);
            }
        });
    });
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
        'pg_dump',
        '"C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"',
        '"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe"',
        '"C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_dump.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe"',
    ];

    return possiblePaths;
}

async function createDevelopmentBackup() {
    console.log('\n🚀 BACKUP PARA DESARROLLO - PRE-COMMIT\n');

    try {
        // Cargar variables de entorno, configurar BD y validar
        loadEnvFile();
        configureDatabase();
        validateConfig();
        // Obtener info del commit
        const commitInfo = await getLastCommitInfo();
        const timestamp = getCurrentDateTime();

        // Crear carpeta de backup con nombre descriptivo
        const backupDirName = `dev_backup_${timestamp}_${commitInfo}`;
        const backupDir = path.join(__dirname, '..', '..', '..', 'backup_database', backupDirName);

        if (!fs.existsSync(path.dirname(backupDir))) {
            fs.mkdirSync(path.dirname(backupDir), { recursive: true });
        }
        fs.mkdirSync(backupDir, { recursive: true });

        console.log(`📁 Carpeta de backup: ${backupDir}\n`);

        // Encontrar pg_dump
        const pgDumpPaths = findPgDumpPath();
        let workingPgDump = null;

        for (const pgDumpPath of pgDumpPaths) {
            try {
                await new Promise((resolve, reject) => {
                    exec(`${pgDumpPath} --version`, (error, stdout) => {
                        if (error) reject(error);
                        else {
                            workingPgDump = pgDumpPath;
                            resolve(stdout);
                        }
                    });
                });
                break;
            } catch (error) {
                continue;
            }
        }

        if (!workingPgDump) {
            throw new Error('No se encontró pg_dump');
        }

        // Crear backup
        const backupFileName = `fabriapp_dev_${timestamp}.sql`;
        const backupFilePath = path.join(backupDir, backupFileName);

        const backupCommand = `${workingPgDump} -h ${dbConfig.host} -U ${dbConfig.username} -d ${dbConfig.database} -p ${dbConfig.port} --clean --create --if-exists --no-owner --no-privileges --verbose > "${backupFilePath}"`;

        console.log('🔄 Creando backup de desarrollo...\n');

        const env = { ...process.env, PGPASSWORD: dbConfig.password };

        await new Promise((resolve, reject) => {
            exec(backupCommand, { env }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (fs.existsSync(backupFilePath)) {
                    const stats = fs.statSync(backupFilePath);

                    console.log('✅ BACKUP DE DESARROLLO COMPLETADO!\n');
                    console.log('=== INFORMACIÓN DEL BACKUP ===');
                    console.log(`📁 Carpeta: ${backupDir}`);
                    console.log(`📄 Archivo: ${backupFileName}`);
                    console.log(`📊 Tamaño: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    console.log(`⏰ Timestamp: ${timestamp}`);
                    console.log(`🔀 Commit: ${commitInfo}`);

                    // Crear script de restauración específico
                    const restoreScript = `// Script de restauración para este backup
const config = {
    username: 'postgres',
    password: 'Carlos.2020#',
    host: '127.0.0.1',
    port: 5432,
    sourceBackupFile: '${backupFilePath.replace(/\\/g, '\\\\')}',
    targetDatabase: 'fabriapp_restored' // Cambiar por el nombre deseado
};

// Para restaurar, ejecuta:
// node restore-backup.js
// (modificando la configuración arriba)
`;

                    fs.writeFileSync(path.join(backupDir, 'restore-info.js'), restoreScript);

                    console.log('\n📋 Archivo de restauración creado: restore-info.js');
                    console.log('\n💡 Para restaurar este backup:');
                    console.log('   1. Crear nueva base de datos');
                    console.log('   2. Modificar restore-backup.js con la ruta de este archivo');
                    console.log('   3. Ejecutar node restore-backup.js');

                    resolve(backupFilePath);
                } else {
                    reject(new Error('Archivo de backup no creado'));
                }
            });
        });

    } catch (error) {
        console.error('\n❌ Error en backup de desarrollo:', error.message);
        throw error;
    }
}

// Ejecutar
async function main() {
    try {
        await createDevelopmentBackup();
        console.log('\n🎯 BACKUP DE DESARROLLO LISTO PARA COMMIT! 🚀');
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        process.exit(1);
    }
}

main(); 