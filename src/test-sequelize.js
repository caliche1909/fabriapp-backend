const db = require('./models');

async function testRoles() {
  try {
    console.log('\n📋 Consultando todos los roles:');
    const roles = await db.roles.findAll({
      order: [['created_at', 'ASC']]
    });
    
    console.log('\n=== Roles encontrados ===');
    roles.forEach(role => {
      console.log(`
🔑 ID: ${role.id}
📝 Nombre: ${role.name}
🌐 Global: ${role.is_global ? 'Sí' : 'No'}
📅 Creado: ${role.created_at}
      `);
    });
    
    console.log('\n📊 Total de roles:', roles.length);

    // Consultar específicamente los roles globales
    console.log('\n🌐 Roles Globales:');
    const globalRoles = await db.roles.getGlobalRoles();
    globalRoles.forEach(role => {
      console.log(`- ${role.name}`);
    });

  } catch (error) {
    console.error("\n❌ Error al consultar roles:", error.message);
    console.error("Stack:", error.stack);
  } finally {
    await db.sequelize.close();
  }
}

testRoles();
