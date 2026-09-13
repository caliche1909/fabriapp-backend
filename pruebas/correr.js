/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CORREDOR DE LAS BATERÍAS DEL BACKEND
 *
 *   node pruebas/correr.js            → todas
 *   node pruebas/correr.js venta      → solo las que lleven "venta" en el nombre
 *
 * 🔴 LA RAZÓN DE QUE ESTO EXISTA, y no un bucle de tres líneas: **una prueba que
 * revienta al cargar no imprime ningún total**. Un bucle ingenuo la suma como
 * "0 fallas" — es decir, la da por buena. Ya pasó: una batería dejó de arrancar
 * al cambiarle una dependencia y el resumen siguió saliendo en verde.
 *
 * Así que aquí hay **tres** desenlaces, no dos: pasó, falló, o **no arrancó**.
 * El último es el peligroso y por eso se cuenta aparte y se nombra.
 * ───────────────────────────────────────────────────────────────────────────── */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Lo que más tarda hoy ronda el minuto; cinco es holgado sin ser eterno. */
const MS_TOPE_POR_BATERIA = 5 * 60 * 1000;

const filtro = process.argv[2] || '';

const archivos = fs.readdirSync(__dirname)
    .filter((n) => n.startsWith('prueba-') && n.endsWith('.js'))
    .filter((n) => n.includes(filtro))
    .sort();

if (archivos.length === 0) {
    console.error(`No hay ninguna batería que contenga "${filtro}".`);
    process.exit(1);
}

/**
 * Los CUATRO formatos de resumen que hay en la carpeta. Se escribieron en momentos distintos y
 * nadie los unificó.
 *
 * 🔴 RECONOCERLOS TODOS NO ES COSMÉTICA. Si el corredor no entiende el resumen de una batería,
 * la da por "no arrancó" aunque haya pasado entera — y un corredor que grita en falso se acaba
 * ignorando exactamente igual que uno que calla los fallos. Pasó con `prueba-ajuste.js`, que
 * decía "38 pasaron, 0 fallaron" y aquí salía en rojo.
 *
 * Si escribes una batería nueva, usa el primer formato. Si usas otro, añádelo aquí.
 */
const FORMATOS = [
    // `=== 197 OK · 0 FALLAS ===`, y su variante con ═══
    { re: /(?:===|═══)\s*(\d+)\s*OK\s*·\s*(\d+)\s*FALLAS?\s*(?:===|═══)/, ok: 1, fallas: 2 },
    // `🎉  38 pasaron, 0 fallaron` · `*** TODO EN VERDE ***  38 pasaron, 0 fallaron`
    { re: /(\d+)\s+pasaron,\s*(\d+)\s+fallaron/, ok: 1, fallas: 2 },
    // `❌ 3 fallo(s)` — este no dice cuántas pasaron
    { re: /❌\s*(\d+)\s*fallo/, ok: null, fallas: 1 },
    // `✅ TODO OK` — tampoco lo dice, pero afirma que no falló ninguna
    { re: /✅\s*TODO OK/, ok: null, fallas: null },
];

/** `{ok, fallas}` con `ok` en null si el formato no lo dice; null entero si no arrancó. */
const leerResumen = (salida) => {
    for (const f of FORMATOS) {
        const m = salida.match(f.re);
        if (!m) continue;
        return {
            ok: f.ok === null ? null : Number(m[f.ok]),
            fallas: f.fallas === null ? 0 : Number(m[f.fallas]),
        };
    }
    return null;
};

let sumaOk = 0;
let sumaFallas = 0;
const rotas = [];
const conFallas = [];
/** Pasaron, pero su formato no dice cuántas aserciones: no entran en la suma. */
const sinConteo = [];

for (const archivo of archivos) {
    let salida;
    try {
        salida = execFileSync(process.execPath, [path.join(__dirname, archivo)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 32 * 1024 * 1024,
            // 🔴 Una batería que se cuelga congela la suite ENTERA, y no hay forma de saber si
            // avanza o no. Ya pasó: `prueba-carrera-startroute` se bloqueaba a sí misma y el
            // corredor se quedaba mudo para siempre. Con el tope, una colgada se informa como
            // "NO ARRANCÓ" —que es verdad: no llegó a dar un resultado— y las demás siguen.
            timeout: MS_TOPE_POR_BATERIA,
        });
    } catch (e) {
        // Salida distinta de 0: puede ser una batería que falló aserciones (que sí imprime su
        // total) o una que ni llegó a arrancar (que no imprime nada). Lo decide `leerResumen`.
        salida = `${e.stdout || ''}${e.stderr || ''}`;
    }

    const resumen = leerResumen(salida);

    if (!resumen) {
        rotas.push(archivo);
        const ultima = salida.trim().split('\n').filter(Boolean).pop() || '(sin salida)';
        console.log(`  NO ARRANCÓ  ${archivo}`);
        console.log(`              ${ultima.slice(0, 120)}`);
        continue;
    }

    const { ok, fallas } = resumen;
    if (ok === null) sinConteo.push(archivo); else sumaOk += ok;
    sumaFallas += fallas;
    if (fallas > 0) conFallas.push(`${archivo} (${fallas})`);

    const marca = fallas === 0 ? '  OK        ' : '  CON FALLAS';
    const cuenta = ok === null ? `${fallas} fallas (su formato no dice cuántas pasaron)` : `${ok} OK · ${fallas} FALLAS`;
    console.log(`${marca}  ${archivo.padEnd(38)} ${cuenta}`);
}

console.log('\n' + '='.repeat(70));
console.log(`  ${archivos.length} baterías · ${sumaOk} aserciones OK · ${sumaFallas} fallas`);
if (sinConteo.length) {
    console.log(`  ${sinConteo.length} pasaron sin decir cuántas aserciones; NO están en la suma de arriba.`);
}
if (conFallas.length) console.log(`  Con fallas: ${conFallas.join(', ')}`);
if (rotas.length) console.log(`  🔴 NO ARRANCARON (esto NO es "0 fallas"): ${rotas.join(', ')}`);
console.log('='.repeat(70));

process.exit(sumaFallas > 0 || rotas.length > 0 ? 1 : 0);
