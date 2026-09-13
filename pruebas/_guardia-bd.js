/**
 * ─────────────────────────────────────────────────────────────────────────────
 * GUARDIA DE LAS PRUEBAS QUE ESCRIBEN EN LA BASE DE DATOS
 *
 * 🔴 POR QUÉ EXISTE. Estas baterías no son de solo lectura: **borran y reconstruyen
 * la jornada de HOY**, crean ventas, mueven stock y limpian lo que crean. Contra una
 * base que alguien esté usando destruyen trabajo real — ya pasó dos veces.
 *
 * Y el riesgo no es teórico: la instancia de Cloud SQL `fabriapp-db-dev` acepta
 * conexiones **desde cualquier IP** (`0.0.0.0/0`, decisión aplazada). Un `.env` mal
 * apuntado y una de estas pruebas borra la jornada de los vendedores de verdad.
 *
 * Así que la regla es al revés de lo habitual: **no basta con que el destino parezca
 * seguro, tiene que demostrarlo**. Solo se deja pasar `localhost`.
 * ───────────────────────────────────────────────────────────────────────────── */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/** Los mismos valores por defecto que `src/config/config.js`, para no divergir. */
const anfitrion = (process.env.DB_HOST || '127.0.0.1').trim().toLowerCase();
const base = (process.env.DB_NAME || 'fabriapp').trim();

const LOCALES = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** La de producción se llama `postgres`, no `fabriapp`. Ver `INFRASTRUCTURE.md`. */
const NOMBRE_DE_PRODUCCION = 'postgres';

const negarse = (motivo) => {
    console.error('\n' + '='.repeat(78));
    console.error('  PRUEBA DETENIDA — ' + motivo);
    console.error('='.repeat(78));
    console.error(`  Destino leído de server/.env:  ${anfitrion}:${process.env.DB_PORT || 5432}/${base}`);
    console.error('');
    console.error('  Estas pruebas BORRAN Y RECONSTRUYEN la jornada de hoy. Solo pueden correr');
    console.error('  contra una copia local y desechable.');
    console.error('');
    console.error('  Para trabajar con datos de producción: expórtalos, restaura la copia en');
    console.error('  local y apunta el .env ahí. Nunca al revés.');
    console.error('='.repeat(78) + '\n');
    process.exit(1);
};

if (!LOCALES.includes(anfitrion)) {
    negarse('la base de datos NO es local');
}

if (base === NOMBRE_DE_PRODUCCION) {
    // Cinturón y tirantes: aunque el anfitrión fuera local, ese nombre delata una
    // restauración hecha con el nombre de producción, y confundirlas sale muy caro.
    negarse(`la base se llama "${NOMBRE_DE_PRODUCCION}", que es el nombre de PRODUCCIÓN`);
}
