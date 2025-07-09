const db = require('./models');

async function testRolesStructure() {
    try {
        console.log('\n🔍 ANALIZANDO ESTRUCTURA DE LA TABLA ROLES EN BASE DE DATOS...\n');

        // Obtener información de la tabla roles
        const queryInterface = db.sequelize.getQueryInterface();
        const tableInfo = await queryInterface.describeTable('roles');

        console.log('=== ESTRUCTURA DE LA TABLA ROLES ===\n');
        console.log('📋 CAMPOS DISPONIBLES:');
        Object.keys(tableInfo).forEach(field => {
            const info = tableInfo[field];
            console.log(`   • ${field}: ${info.type} (${info.allowNull ? 'NULL' : 'NOT NULL'})`);
        });

        // Consultar algunos roles para ver los datos
        console.log('\n=== MUESTRA DE DATOS EN LA TABLA ROLES ===\n');
        const sampleRoles = await db.roles.findAll({
            limit: 5,
            order: [['name', 'ASC']]
        });

        if (sampleRoles.length > 0) {
            console.log('📋 PRIMEROS 5 ROLES:');
            sampleRoles.forEach((role, index) => {
                console.log(`\n${index + 1}. ${role.name} (${role.id})`);
                console.log(`   • Label: ${role.label || 'Sin label'}`);
                console.log(`   • Description: ${role.description || 'Sin descripción'}`);
                console.log(`   • Is Global: ${role.is_global ? 'Sí' : 'No'}`);
                console.log(`   • Company ID: ${role.company_id || 'NULL (global)'}`);
                console.log(`   • Created At: ${role.created_at}`);
            });
        } else {
            console.log('❌ No se encontraron roles en la base de datos');
        }

        // Verificar si el campo description existe
        const hasDescription = tableInfo.hasOwnProperty('description');
        console.log('\n=== VERIFICACIÓN DEL CAMPO DESCRIPTION ===');
        console.log(`🔍 Campo 'description' existe: ${hasDescription ? '✅ SÍ' : '❌ NO'}`);

        if (hasDescription) {
            console.log(`📋 Tipo de dato: ${tableInfo.description.type}`);
            console.log(`📋 Permite NULL: ${tableInfo.description.allowNull ? 'Sí' : 'No'}`);
        } else {
            console.log('⚠️  El campo description NO existe en la tabla roles');
            console.log('💡 Necesita agregarse para incluir descripciones en las respuestas');
        }

    } catch (error) {
        console.error("\n❌ Error al consultar estructura de la tabla roles:", error.message);
        console.error("Stack:", error.stack);
    } finally {
        await db.sequelize.close();
    }
}

// Ejecutar la función
testRolesStructure();
