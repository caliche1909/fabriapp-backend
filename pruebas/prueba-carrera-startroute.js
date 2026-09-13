require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * ¿Sigue siendo posible que DOS usuarios inicien la MISMA ruta el mismo día?
 *
 * Reproduce el patrón exacto de `startRoute` con dos transacciones simultáneas:
 *   1. las dos leen "¿ya está iniciada?" y las dos ven 0 (READ COMMITTED),
 *   2. las dos hacen el bulkCreate con ON CONFLICT DO NOTHING,
 *   3. se mira cuántas paradas quedaron.
 *
 * SEGURIDAD: usa un DÍA FUTURO sintético (hoy + 29) para no tocar ninguna jornada real,
 * verifica que ese día esté vacío antes de empezar y borra al final SOLO lo que creó.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER,'node_modules','dotenv')).config({ path: path.join(SERVER, '.env') });
const { Client } = require(path.join(SERVER, 'node_modules', 'pg'));

const cfg = {
    host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
};

const nuevo = async () => { const c = new Client(cfg); await c.connect(); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Filas como las arma `construirParada`, con el user_id que se le pase.
const filas = (stores, routeId, userId, dia) => stores.map((s) => `(
    '${userId}', ${s.id}, ${routeId}, CAST('${dia}' AS timestamp), 'pending',
    $$${(s.name || '').replace(/\$/g, '')}$$, $$${(s.address || '').replace(/\$/g, '')}$$,
    'RUTA PRUEBA', 'USUARIO PRUEBA', '${dia}', 0, now(), now())`).join(',');

const INSERT = (vals) => `INSERT INTO store_visits
    (user_id, store_id, route_id, date, status, store_name, store_address, route_name, user_name, visit_day, sale_amount, created_at, updated_at)
    VALUES ${vals} ON CONFLICT DO NOTHING`;

(async () => {
    const admin = await nuevo();
    let rid, dia, storesRuta, uA, uB;
    let ok = 0, fail = 0;
    const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK   ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };

    try {
        // ── Preparar: una ruta con tiendas y un día futuro VACÍO ───────────────
        const r = await admin.query(`
            SELECT rs.route_id, count(*)::int AS n
              FROM routes_stores rs GROUP BY rs.route_id ORDER BY n DESC LIMIT 1`);
        rid = r.rows[0].route_id;
        const d = await admin.query(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date + 29, 'YYYY-MM-DD') AS dia`);
        dia = d.rows[0].dia;

        const vacio = await admin.query('SELECT count(*)::int AS n FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
        if (vacio.rows[0].n !== 0) throw new Error(`El día ${dia} de la ruta ${rid} NO está vacío. Abortado por seguridad.`);

        const st = await admin.query(`
            SELECT s.id, s.name, s.address FROM stores s
              JOIN routes_stores rs ON rs.store_id = s.id
             WHERE rs.route_id = $1 AND s.deleted_at IS NULL ORDER BY s.id`, [rid]);
        storesRuta = st.rows;

        const us = await admin.query('SELECT id FROM users ORDER BY id LIMIT 2');
        uA = us.rows[0].id; uB = us.rows[1].id;

        console.log(`\nRuta ${rid} · ${storesRuta.length} tiendas · día sintético ${dia}`);
        console.log(`Usuario A=${uA}  ·  Usuario B=${uB}  (dos personas distintas, a propósito)\n`);

        // ── La carrera ────────────────────────────────────────────────────────
        const A = await nuevo(); const B = await nuevo();
        await A.query('BEGIN'); await B.query('BEGIN');

        const cA = await A.query('SELECT count(*)::int AS n FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
        const cB = await B.query('SELECT count(*)::int AS n FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
        assert(cA.rows[0].n === 0 && cB.rows[0].n === 0,
            'las dos transacciones ven "ruta sin iniciar" (el chequeo del controlador NO las separa)');

        // A inserta su jornada y NO confirma todavía.
        const insA = await A.query(INSERT(filas(storesRuta, rid, uA, dia)));
        assert(insA.rowCount === storesRuta.length, `A crea sus ${insA.rowCount} paradas (sin confirmar)`);

        // B intenta lo mismo, a nombre de OTRO usuario, mientras A sigue abierta.
        let bTerminada = false;
        const pB = B.query(INSERT(filas(storesRuta, rid, uB, dia))).then((x) => { bTerminada = true; return x; });
        await sleep(700);
        assert(!bTerminada, 'B queda BLOQUEADA esperando a A (el candado de la BD actúa antes del commit)');

        await A.query('COMMIT');
        const insB = await pB;
        assert(insB.rowCount === 0, `B se desbloquea y crea 0 paradas (ON CONFLICT DO NOTHING) — insertó ${insB.rowCount}`);
        await B.query('COMMIT');

        const fin = await admin.query(`
            SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS usuarios
              FROM store_visits WHERE route_id=$1 AND visit_day=$2`, [rid, dia]);
        assert(fin.rows[0].n === storesRuta.length, `queda UNA sola jornada de ${fin.rows[0].n} paradas (no ${storesRuta.length * 2})`);
        assert(fin.rows[0].usuarios === 1, `un SOLO responsable (${fin.rows[0].usuarios} usuario distinto)`);
        const quien = await admin.query('SELECT DISTINCT user_id FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
        assert(quien.rows[0].user_id === uA, 'el responsable es A, el que llegó primero (B no lo pisa)');

        await A.end(); await B.end();

        // ── Riesgo residual: ¿y si las dos insertan en ORDEN DISTINTO? ─────────
        await admin.query('DELETE FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
        const C = await nuevo(); const D = await nuevo();
        await C.query('BEGIN'); await D.query('BEGIN');
        // 🔴 SIN ESTO LA PRUEBA SE CUELGA PARA SIEMPRE, y no por un fallo del sistema.
        // C toma las 5 PRIMERAS tiendas y D las 5 ULTIMAS. En una ruta de mas de 10 esos dos
        // grupos NO se solapan, asi que D no espera a nadie: no hay abrazo mortal que Postgres
        // pueda detectar y romper. Cuando C pide despues las filas de D se queda esperando a que
        // D confirme... y D no confirma hasta despues del `Promise.all`, que espera a C. La prueba
        // se bloquea a si misma. Y la ruta elegida es la que MAS tiendas tiene (44 en produccion),
        // asi que pasaba siempre. Con `lock_timeout` la espera muere sola y la prueba informa de
        // lo que vio, en vez de dejar colgada la suite entera.
        await C.query("SET LOCAL lock_timeout = '2500ms'");
        await D.query("SET LOCAL lock_timeout = '2500ms'");
        const alReves = [...storesRuta].reverse();
        await C.query(INSERT(filas(storesRuta.slice(0, 5), rid, uA, dia)));
        const pD = D.query(INSERT(filas(alReves.slice(0, 5), rid, uB, dia))).catch((e) => ({ error: e }));
        await sleep(400);
        // C intenta ahora lo que D ya tomó → abrazo mortal si los órdenes chocan
        const pC = C.query(INSERT(filas(alReves.slice(0, 5), rid, uA, dia))).catch((e) => ({ error: e }));
        const [rC, rD] = await Promise.all([pC, pD]);
        const codigos = [rC, rD].map((x) => (x && x.error ? String(x.error.code) : null));
        const deadlock = codigos.includes('40P01');
        // 55P03 = lock_timeout. No es un abrazo mortal, pero SI es una espera real: una de las dos
        // se quedo bloqueada por la otra. Se informa aparte para no confundir los dos casos.
        const esperaLarga = codigos.includes('55P03');
        console.log(`
   ${deadlock ? 'RIESGO' : 'nota '} orden distinto de inserción → ${
            deadlock ? 'DEADLOCK (uno recibe 500)'
                : esperaLarga ? 'sin deadlock, pero una espera a la otra hasta que confirme'
                    : 'sin deadlock en esta corrida'}`);
        try { await C.query('ROLLBACK'); } catch { /* ya abortada */ }
        try { await D.query('ROLLBACK'); } catch { /* ya abortada */ }
        await C.end(); await D.end();

    } catch (e) {
        console.error('\nERROR:', e.message);
        fail++;
    } finally {
        if (rid && dia) {
            const del = await admin.query('DELETE FROM store_visits WHERE route_id=$1 AND visit_day=$2', [rid, dia]);
            console.log(`\nLimpieza: ${del.rowCount} fila(s) sintética(s) del día ${dia} eliminadas.`);
        }
        await admin.end();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
