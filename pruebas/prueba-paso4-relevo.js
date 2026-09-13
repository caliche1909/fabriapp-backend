require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 4 — El relevo: al reasignar la ruta, las paradas PENDIENTES de las jornadas abiertas
 * pasan al nuevo encargado; las resueltas y el pasado NO se tocan.
 * ⚠️ Respalda la jornada de hoy (y el día futuro que crea) y restaura todo.
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, routes } = require(path + 'models');
const rutasCtrl = require(path + 'controllers/routes_controller');
const tiendasCtrl = require(path + 'controllers/stores_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const CARLOS = '5f27545a-130d-4b8f-ad07-52c87dc31f4d';
const JOSE = '236b06db-6d05-478a-9cd9-32a8200e267a';

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (c, m, req) => { const res = mkRes(); await c[m](req, res); return { status: res._s, body: res._j }; };
const usuario = (id, tipo = 'collaborator') => ({ id, companyId: COMPANY, userType: tipo, companyTimezone: 'America/Bogota', permissions: [] });
const marcar = (u, storeId) => call(tiendasCtrl, 'updateStoreAsVisited', { user: u, params: { store_id: String(storeId) }, body: { distance: 5, route_id: RID } });
const reasignar = (nuevoUserId) => call(rutasCtrl, 'updateRoute', {
    user: usuario(CARLOS, 'owner'), params: { id: String(RID) },
    body: { name: 'Ruta Carolina - Quito Lopéz', user_id: nuevoUserId },
});

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy, futuro, ayer }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy,
                                                    to_char((now() AT TIME ZONE 'America/Bogota')::date + 2,'YYYY-MM-DD') AS futuro,
                                                    to_char((now() AT TIME ZONE 'America/Bogota')::date - 1,'YYYY-MM-DD') AS ayer`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day IN (CAST(:h AS date), CAST(:f AS date), CAST(:a AS date)) ORDER BY id`,
        { r: RID, h: hoy, f: futuro, a: ayer });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    const nombreOriginal = (await q(`SELECT name, user_id::text FROM routes WHERE id=:r`, { r: RID }))[0];
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas (hoy/${futuro}/${ayer})\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day IN (CAST(:h AS date), CAST(:f AS date), CAST(:a AS date))`,
            { replacements: { r: RID, h: hoy, f: futuro, a: ayer } });
        for (const fila of respaldo) {
            const cols = columnas.map(c => `"${c}"`).join(', ');
            const vals = columnas.map(c => `:${c}`).join(', ');
            await sequelize.query(`INSERT INTO store_visits (${cols}) VALUES (${vals})`, { replacements: fila });
        }
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('store_visits','id'), (SELECT max(id) FROM store_visits))`);
        await routes.update({ user_id: nombreOriginal.user_id, name: nombreOriginal.name }, { where: { id: RID } });
    };
    const cuenta = (dia, uid, estado) => q(
        `SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)
          AND user_id=CAST(:u AS uuid)` + (estado ? ` AND status='${estado}'` : ''), { r: RID, d: dia, u: uid });

    try {
        // ── Montaje: jornada de AYER (histórico), de HOY y programada a FUTURO, todas de Jose ──
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day IN (CAST(:h AS date), CAST(:f AS date), CAST(:a AS date))`,
            { replacements: { r: RID, h: hoy, f: futuro, a: ayer } });
        await routes.update({ user_id: JOSE }, { where: { id: RID } });
        await call(rutasCtrl, 'startRoute', { user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });
        await call(rutasCtrl, 'startRoute', { user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) }, body: { visit_day: futuro } });
        // "Ayer": se clona la jornada de hoy con fecha de ayer (histórico intocable).
        await sequelize.query(
            `INSERT INTO store_visits (user_id, store_id, route_id, visit_day, status, user_name, store_name, store_address, route_name, sale_amount, date, created_at, updated_at)
             SELECT user_id, store_id, route_id, CAST(:a AS date), 'pending', user_name, store_name, store_address, route_name, 0, CAST(:a AS date), now(), now()
               FROM store_visits WHERE route_id=:r AND visit_day=CAST(:h AS date)`,
            { replacements: { r: RID, h: hoy, a: ayer } });

        const total = (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n;
        const p = await q(`SELECT id, store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 2`, { r: RID, d: hoy });

        console.log('1️⃣  Jose resuelve dos paradas de hoy');
        await marcar(usuario(JOSE), p[0].store_id);
        await marcar(usuario(JOSE), p[1].store_id);
        check('2 resueltas a nombre de Jose', (await cuenta(hoy, JOSE, 'visited'))[0].n === 2);

        console.log('\n2️⃣  RELEVO: la ruta pasa a Carlos');
        let r = await reasignar(CARLOS);
        check('responde 200', r.status === 200, JSON.stringify(r.body.message));
        check('informa el traspaso en el mensaje', /traspasaron/.test(r.body.message), r.body.message);
        check('reporta el relevo estructurado', r.body.relevo && r.body.relevo.hubo_cambio === true, JSON.stringify(r.body.relevo));

        console.log('\n3️⃣  Qué se movió y qué no');
        check('las PENDIENTES de hoy son de Carlos', (await cuenta(hoy, CARLOS, 'pending'))[0].n === total - 2, String((await cuenta(hoy, CARLOS, 'pending'))[0].n));
        check('a Jose no le queda ninguna pendiente hoy', (await cuenta(hoy, JOSE, 'pending'))[0].n === 0);
        check('las RESUELTAS siguen siendo de Jose', (await cuenta(hoy, JOSE, 'visited'))[0].n === 2);
        check('la jornada FUTURA también se traspasó', (await cuenta(futuro, CARLOS))[0].n === total, String((await cuenta(futuro, CARLOS))[0].n));
        check('el PASADO no se tocó', (await cuenta(ayer, JOSE))[0].n === total, String((await cuenta(ayer, JOSE))[0].n));
        check('el traspaso cuadra con lo reportado', r.body.relevo.visitas_traspasadas === (total - 2) + total, String(r.body.relevo.visitas_traspasadas));

        const nombre = (await q(`SELECT DISTINCT user_name FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) AND user_id=CAST(:u AS uuid) AND status='pending'`, { r: RID, d: hoy, u: CARLOS }));
        check('el user_name desnormalizado se actualizó', nombre.length === 1 && /Carlos/.test(nombre[0].user_name), JSON.stringify(nombre));

        console.log('\n4️⃣  El nuevo encargado ya puede trabajar lo traspasado');
        const pend = (await q(`SELECT store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) AND status='pending' ORDER BY id LIMIT 1`, { r: RID, d: hoy }))[0];
        r = await marcar(usuario(CARLOS, 'owner'), pend.store_id);
        check('Carlos marca una parada traspasada', r.status === 200, `${r.status}: ${r.body.message}`);

        console.log('\n5️⃣  Reasignar sin cambios reales no mueve nada');
        r = await reasignar(CARLOS);
        check('no reporta traspasos', r.body.relevo.hubo_cambio === false && r.body.relevo.visitas_traspasadas === 0, JSON.stringify(r.body.relevo));

        console.log('\n6️⃣  Dejar la ruta SIN encargado: avisa en vez de romper');
        r = await reasignar(null);
        check('responde 200', r.status === 200);
        check('advierte que nadie podrá atenderlas', /SIN encargado/.test(r.body.message), r.body.message);
        check('cuenta las pendientes huérfanas', r.body.relevo.pendientes_sin_encargado > 0, JSON.stringify(r.body.relevo));
        check('no movió ninguna parada', r.body.relevo.visitas_traspasadas === 0);
    } finally {
        console.log('\n7️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, user_id::text, status FROM store_visits WHERE route_id=:r AND visit_day IN (CAST(:h AS date), CAST(:f AS date), CAST(:a AS date)) ORDER BY id`,
        { r: RID, h: hoy, f: futuro, a: ayer });
    check(`paradas idénticas (${respaldo.length})`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.user_id === respaldo[i].user_id && f.status === respaldo[i].status), `${fin.length} filas`);
    const rutaFin = (await q(`SELECT name, user_id::text FROM routes WHERE id=:r`, { r: RID }))[0];
    check('ruta con su nombre y encargado originales', rutaFin.user_id === nombreOriginal.user_id && rutaFin.name === nombreOriginal.name);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
