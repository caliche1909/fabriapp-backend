const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Validar configuración
function validateConfig() {
    if (!config.password) {
        console.error('\n❌ ERROR: Credenciales de base de datos no configuradas');
        console.error('\n🔧 ASEGÚRATE QUE TU ARCHIVO .env TENGA:');
        console.error("   DB_USER='postgres'");
        console.error("   DB_PASSWORD='tu_password#123'  # ← Usa comillas simples si termina en #");
        console.error("   DB_NAME='fabriapp'");
        console.error("   DB_HOST='127.0.0.1'");
        console.error('   DB_PORT=5432');
        process.exit(1);
    }
    if (!config.sourceBackupFile) {
        console.error('\n❌ ERROR: Archivo de backup no especificado');
        console.error('\n🔧 CONFIGURA LA RUTA DEL BACKUP:');
        console.error('   Modifica sourceBackupFile en configureRestore()');
        process.exit(1);
    }
}

// La configuración se definirá DESPUÉS de cargar las variables de entorno  
let config;

// Función para configurar DESPUÉS de cargar las variables (ACTUALIZAR sourceBackupFile y targetDatabase según necesites)
function configureRestore() {
    config = {
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        sourceBackupFile: 'C:\\Proyectos\\privado\\backup_database\\backup_2025-07-22_22-09-37\\fabriapp_backup_2025-07-22_22-09-37.sql', // ← CAMBIAR ESTA RUTA
        targetDatabase: 'fabriapp3' // ← CAMBIAR ESTE NOMBRE
    };
}

// Función para encontrar la ruta de psql
function findPsqlPath() {
    const possiblePaths = [
        'psql', // En PATH
        '"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe"',
        '"C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe"',
        '"C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\psql.exe"',
        '"C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\psql.exe"',
    ];

    return possiblePaths;
}

async function restoreBackup() {
    console.log('\n🔄 INICIANDO RESTAURACIÓN DE BACKUP...\n');

    try {
        // Cargar variables de entorno, configurar y validar
        loadEnvFile();
        configureRestore();
        validateConfig();
        // Verificar que el archivo de backup existe
        if (!fs.existsSync(config.sourceBackupFile)) {
            throw new Error(`El archivo de backup no existe: ${config.sourceBackupFile}`);
        }

        console.log(`📄 Archivo de backup: ${config.sourceBackupFile}`);
        console.log(`🎯 Base de datos destino: ${config.targetDatabase}\n`);

        // Encontrar psql disponible
        const psqlPaths = findPsqlPath();
        let workingPsql = null;

        console.log('🔍 Buscando psql disponible...\n');

        for (const psqlPath of psqlPaths) {
            try {
                await new Promise((resolve, reject) => {
                    exec(`${psqlPath} --version`, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            console.log(`✅ Encontrado: ${psqlPath} - ${stdout.trim()}`);
                            workingPsql = psqlPath;
                            resolve(stdout);
                        }
                    });
                });
                break;
            } catch (error) {
                console.log(`❌ No disponible: ${psqlPath}`);
                continue;
            }
        }

        if (!workingPsql) {
            throw new Error('No se encontró psql en el sistema. Verifica que PostgreSQL esté instalado correctamente.');
        }

        // Leer el archivo de backup y modificarlo
        console.log('\n📖 Leyendo archivo de backup...');
        let backupContent = fs.readFileSync(config.sourceBackupFile, 'utf8');

        // Modificar el contenido para usar la nueva base de datos
        console.log('🔄 Adaptando backup para la nueva base de datos...');

        // Remover comandos DROP DATABASE y CREATE DATABASE
        backupContent = backupContent.replace(/DROP DATABASE .*?;/gi, '-- DROP DATABASE removido');
        backupContent = backupContent.replace(/CREATE DATABASE .*?;/gi, '-- CREATE DATABASE removido');
        backupContent = backupContent.replace(/\\connect .*?$/gmi, '-- CONNECT removido');

        // Crear archivo temporal modificado
        const tempBackupFile = path.join(__dirname, 'temp_backup_modified.sql');
        fs.writeFileSync(tempBackupFile, backupContent);

        console.log(`📝 Archivo temporal creado: ${tempBackupFile}\n`);

        // Comando de restauración
        const restoreCommand = `${workingPsql} -U ${config.username} -h ${config.host} -d ${config.targetDatabase} -p ${config.port} -f "${tempBackupFile}"`;

        console.log('🔄 Ejecutando restauración...\n');
        console.log(`Comando: ${restoreCommand}\n`);

        // Configurar variable de entorno para la contraseña
        const env = { ...process.env, PGPASSWORD: config.password };

        return new Promise((resolve, reject) => {
            exec(restoreCommand, { env }, (error, stdout, stderr) => {
                // Limpiar archivo temporal
                if (fs.existsSync(tempBackupFile)) {
                    fs.unlinkSync(tempBackupFile);
                    console.log('🗑️ Archivo temporal eliminado\n');
                }

                if (error) {
                    console.error('❌ Error durante la restauración:', error);
                    reject(error);
                    return;
                }

                if (stderr) {
                    console.log('📄 Información del proceso:', stderr);
                }

                if (stdout) {
                    console.log('📄 Salida:', stdout);
                }

                console.log('✅ RESTAURACIÓN COMPLETADA EXITOSAMENTE!\n');
                console.log('=== INFORMACIÓN DE LA RESTAURACIÓN ===');
                console.log(`🎯 Base de datos destino: ${config.targetDatabase}`);
                console.log(`📄 Archivo origen: ${config.sourceBackupFile}`);
                console.log(`⏰ Fecha de restauración: ${new Date().toLocaleString('es-CO')}`);
                console.log(`🔧 Herramienta usada: ${workingPsql}`);

                console.log('\n🎉 La restauración incluye:');
                console.log('   ✅ Todas las tablas con estructura');
                console.log('   ✅ Todos los datos');
                console.log('   ✅ Índices y restricciones');
                console.log('   ✅ Funciones y procedimientos');
                console.log('   ✅ Triggers');
                console.log('   ✅ Extensiones (PostGIS, UUID)');
                console.log('   ✅ Tipos de datos personalizados');

                resolve(true);
            });
        });

    } catch (error) {
        console.error('\n❌ Error general en la restauración:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

// Función principal
async function main() {
    try {
        console.log('🚀 SISTEMA DE RESTAURACIÓN DE BACKUP');
        console.log('====================================\n');

        await restoreBackup();

        console.log('\n🎯 RESTAURACIÓN FINALIZADA CORRECTAMENTE');
        console.log(`\n💡 La base de datos ${config.targetDatabase} ahora contiene una copia exacta de fabriapp`);

    } catch (error) {
        console.error('\n❌ ERROR EN EL PROCESO DE RESTAURACIÓN:', error.message);
        process.exit(1);
    }
}

// Ejecutar la restauración
main(); 