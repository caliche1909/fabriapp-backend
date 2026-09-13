require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 3 — Lecturas de la jornada: startRoute, getRouteDayVisits y optimizeRoute
 * bajo el modelo "la jornada es de la RUTA". Respalda y restaura.
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
const usuario = (id, tipo = 'collaborator', permisos = []) => ({ id, companyId: COMPANY, userType: tipo, companyTimezone: 'America/Bogota', permissions: permisos });
const visitasDelDia = (u, fecha) => call(rutasCtrl, 'getRouteDayVisits', { user: u, params: { route_id: String(RID) }, query: fecha ? { date: fecha } : {}, body: {} });
const optimizar = (u) => call(rutasCtrl, 'optimizeRoute', { user: u, params: { route_id: String(RID) }, query: { lat: '4.65', lng: '-74.1' }, body: {} });
const iniciar = (u, dia) => call(rutasCtrl, 'startRoute', { user: u, params: { route_id: String(RID) }, body: dia ? { visit_day: dia } : {} });
const marcar = (u, storeId) => call(tiendasCtrl, 'updateStoreAsVisited', { user: u, params: { store_id: String(storeId) }, body: { distance: 5, route_id: RID } });

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    const asignadoOriginal = (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id;
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas\n`);

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
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await routes.update({ user_id: JOSE }, { where: { id: RID } });

        console.log('1️⃣  startRoute: el owner la inicia a nombre del encargado');
        let r = await iniciar(usuario(CARLOS, 'owner'));
        const total = r.body.visitas_del_dia;
        check('creada', r.status === 200 && total > 0, JSON.stringify(r.body.message));
        const p = await q(`SELECT id, store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 3`, { r: RID, d: hoy });

        console.log('\n2️⃣  Jose recorre un poco y luego el RELEVO a Carlos');
        await marcar(usuario(JOSE), p[0].store_id);
        await marcar(usuario(JOSE), p[1].store_id);
        await routes.update({ user_id: CARLOS }, { where: { id: RID } });
        await marcar(usuario(CARLOS, 'owner'), p[2].store_id);
        const mezcla = await q(`SELECT count(DISTINCT user_id)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy });
        check('la jornada quedó repartida entre DOS usuarios', mezcla[0].n === 2, String(mezcla[0].n));

        console.log('\n3️⃣  getRouteDayVisits: la lista NO se parte');
        r = await visitasDelDia(usuario(CARLOS, 'owner'));
        check('el nuevo encargado ve la jornada COMPLETA', r.body.visitas.length === total, `${r.body.visitas.length} de ${total}`);
        check('el resumen cuenta las 3 resueltas', r.body.resumen.visited === 3, JSON.stringify(r.body.resumen));
        check('es_mi_lista = true para el encargado actual', r.body.es_mi_lista === true);
        check('el responsable de HOY es el encargado ACTUAL', r.body.responsable.first_name.trim().startsWith('Carlos'), JSON.stringify(r.body.responsable));

        r = await visitasDelDia(usuario(JOSE));
        check('el encargado ANTERIOR ya no la tiene como suya', r.body.es_mi_lista === false || r.status === 403, `${r.status} / ${r.body.es_mi_lista}`);

        r = await visitasDelDia(usuario('00000000-0000-0000-0000-0000000000ab'));
        check('un tercero sin permiso → 403', r.status === 403, String(r.status));
        r = await visitasDelDia(usuario('00000000-0000-0000-0000-0000000000ab', 'collaborator', ['view_routes_by_company']));
        check('con view_routes_by_company sí consulta', r.status === 200 && r.body.es_mi_lista === false);

        console.log('\n4️⃣  optimizeRoute: escribe, así que exige encargado');
        r = await optimizar(usuario(JOSE));
        check('el anterior encargado ya no optimiza', r.status === 403, `${r.status}: ${r.body.message}`);
        check('el mensaje nombra al encargado', /Carlos/.test(r.body.message || ''), r.body.message);

        r = await optimizar(usuario(CARLOS, 'owner'));
        check('el encargado actual sí optimiza', r.status === 200, `${r.status}: ${r.body.message}`);
        check('ve TODAS las pendientes, no solo las suyas', r.body.resumen.total === total - 3, `${r.body.resumen.total} vs ${total - 3}`);
        const conSeq = (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) AND optimized_seq IS NOT NULL`, { r: RID, d: hoy }))[0].n;
        check('numeró las pendientes', conSeq === total - 3, String(conSeq));
        const resueltasConSeq = (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) AND status <> 'pending' AND optimized_seq IS NOT NULL`, { r: RID, d: hoy }))[0].n;
        check('limpió el orden de las resueltas (aunque sean de Jose)', resueltasConSeq === 0, String(resueltasConSeq));

        console.log('\n5️⃣  startRoute tras el relevo: ya no dice "es de otro"');
        r = await iniciar(usuario(CARLOS, 'owner'));
        check('devuelve already_started en vez de 409', r.status === 200 && r.body.already_started === true, `${r.status}: ${r.body.message}`);
        check('informa el total real del día', r.body.visitas_del_dia === total, String(r.body.visitas_del_dia));
        check('no duplicó nada', (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n === total);

        console.log('\n6️⃣  Reglas que no deben aflojarse');
        r = await iniciar(usuario(JOSE));
        check('el NO encargado no puede iniciar', r.status === 403, `${r.status}: ${r.body.message}`);
        await routes.update({ user_id: null }, { where: { id: RID } });
        r = await optimizar(usuario(CARLOS, 'owner'));
        check('ruta sin encargado → nadie optimiza', r.status === 403, String(r.status));
        await routes.update({ user_id: CARLOS }, { where: { id: RID } });
        r = await optimizar({ ...usuario(CARLOS, 'owner'), companyId: '00000000-0000-0000-0000-0000000000ff' });
        check('ruta de otra compañía → 404', r.status === 404, String(r.status));
    } finally {
        console.log('\n7️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, user_id::text, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.status === respaldo[i].status && f.user_id === respaldo[i].user_id), `${fin.length} filas`);
    check('ruta con su encargado original', (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id === asignadoOriginal);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
