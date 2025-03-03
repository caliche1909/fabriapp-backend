const db = require('./models');

async function testModel() {
  try {
    const inventory = await db.inventory_supplies_balance.findAll({ limit: 5 });
    console.log("✅ Modelo cargado correctamente. Datos:", inventory);
  } catch (error) {
    console.error("❌ Error al probar el modelo:", error);
  }
}

testModel();
