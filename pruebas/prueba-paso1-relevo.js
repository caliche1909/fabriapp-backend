require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 1 — Marcar visitada: autorización por ENCARGADO de la ruta + sellado del actor.
 * Respalda la jornada de hoy y la devuelve literal al final (nunca borra por rango).
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, routes, store_visits } = require(path + 'models');
const rutasCtrl = require(path + 'controllers/routes_controller');
const tiendasCtrl = require(path + 'controllers/stores_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const CARLOS = '5f27545a-130d-4b8f-ad07-52c87dc31f4d';   // owner
const JOSE = '236b06db-6d05-478a-9cd9-32a8200e267a';     // seller

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (c, m, req) => { const res = mkRes(); await c[m](req, res); return { status: res._s, body: res._j }; };
const usuario = (id, tipo = 'collaborator') => ({ id, companyId: COMPANY, userType: tipo, companyTimezone: 'America/Bogota', permissions: [] });
const marcar = (u, storeId) => call(tiendasCtrl, 'updateStoreAsVisited',
    { user: u, params: { store_id: String(storeId) }, body: { distance: 5, route_id: RID } });

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    const asignadoOriginal = (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id;
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas; ruta asignada a ${asignadoOriginal === CARLOS ? 'CARLOS' : 'JOSE'}\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        for (const fila of respaldo) {
            const cols = columnas.map(c => `"${c}"`).join(', ');
            const vals = columnas.map(c => `:${c}`).join(', ');
            await sequelize.query(`INSERT INTO store_visits (${cols}) VALUES (${vals})`, { replacements: fila });
        }
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('store_visits','id'), (SELECT max(id) FROM store_visits))`);
        await routes.update({ user_id: asignadoOriginal }, { where: { id: RID } });
    };

    try {
        // Escenario: la ruta la lleva JOSE y su jornada existe.
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await routes.update({ user_id: JOSE }, { where: { id: RID } });
        await call(rutasCtrl, 'startRoute', { user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });

        const paradas = await q(`SELECT id, store_id, user_id::text FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 4`, { r: RID, d: hoy });
        check('el owner inicia la ruta a nombre del ENCARGADO', paradas.every(p => p.user_id === JOSE));

        console.log('\n1️⃣  Solo el encargado puede marcar');
        let r = await marcar(usuario(CARLOS, 'owner'), paradas[0].store_id);
        check('el OWNER no puede marcar (no es el encargado)', r.status === 403, `${r.status}: ${r.body.message}`);
        check('el mensaje dice quién es el encargado', /Jose luis/.test(r.body.message || ''), r.body.message);

        r = await marcar(usuario(JOSE), paradas[0].store_id);
        check('el ENCARGADO sí puede marcar', r.status === 200, `${r.status}: ${r.body.message}`);

        let fila = (await q(`SELECT status, user_id::text, user_name, arrived_at FROM store_visits WHERE id=:id`, { id: paradas[0].id }))[0];
        check('queda visitada', fila.status === 'visited');
        check('sella el actor en user_id', fila.user_id === JOSE);
        check('sella el nombre del actor', /Jose luis/.test(fila.user_name || ''), String(fila.user_name));

        console.log('\n2️⃣  RELEVO a media jornada: la ruta pasa a Carlos');
        await routes.update({ user_id: CARLOS }, { where: { id: RID } });

        r = await marcar(usuario(JOSE), paradas[1].store_id);
        check('el encargado ANTERIOR ya no puede marcar', r.status === 403, `${r.status}: ${r.body.message}`);

        r = await marcar(usuario(CARLOS, 'owner'), paradas[1].store_id);
        check('el NUEVO encargado marca una parada que era de Jose', r.status === 200, `${r.status}: ${r.body.message}`);

        fila = (await q(`SELECT status, user_id::text, user_name FROM store_visits WHERE id=:id`, { id: paradas[1].id }))[0];
        check('la parada queda a nombre de QUIEN la hizo (Carlos)', fila.user_id === CARLOS, fila.user_id);
        check('con su nombre', /Carlos/.test(fila.user_name || ''), String(fila.user_name));

        const deJose = (await q(`SELECT user_id::text FROM store_visits WHERE id=:id`, { id: paradas[0].id }))[0];
        check('la que hizo Jose SIGUE siendo suya (histórico intacto)', deJose.user_id === JOSE);

        console.log('\n3️⃣  Reglas que no deben aflojarse');
        r = await marcar(usuario(CARLOS, 'owner'), paradas[1].store_id);
        check('no se puede marcar dos veces', r.status === 409, `${r.status}: ${r.body.message}`);

        r = await marcar(usuario('00000000-0000-0000-0000-0000000000aa'), paradas[2].store_id);
        check('un tercero sin relación con la ruta → 403', r.status === 403, String(r.status));

        await routes.update({ user_id: null }, { where: { id: RID } });
        r = await marcar(usuario(CARLOS, 'owner'), paradas[2].store_id);
        check('ruta sin encargado → nadie puede marcar', r.status === 403, `${r.status}: ${r.body.message}`);
        await routes.update({ user_id: CARLOS }, { where: { id: RID } });

        r = await call(tiendasCtrl, 'updateStoreAsVisited',
            { user: usuario(CARLOS, 'owner'), params: { store_id: String(paradas[2].store_id) }, body: { distance: 5000, route_id: RID } });
        check('la distancia máxima se sigue respetando', r.status === 400, String(r.status));
    } finally {
        console.log('\n4️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, user_id::text, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const asignado = (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id;
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.user_id === respaldo[i].user_id && f.status === respaldo[i].status),
        `${fin.length} filas`);
    check('ruta con su encargado original', asignado === asignadoOriginal);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
