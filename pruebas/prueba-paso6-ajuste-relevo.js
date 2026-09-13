require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 6 — El motor de ajuste con la jornada REPARTIDA tras un relevo.
 * Regresión del bug de las "47 faltantes fantasma": agrupar por (día, persona) partía la
 * jornada en dos y cada tienda parecía faltarle al bloque de quien no la tenía.
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
const u = (id, t = 'collaborator') => ({ id, companyId: COMPANY, userType: t, companyTimezone: 'America/Bogota', permissions: [] });
const diagnostico = () => call(rutasCtrl, 'getRouteAdjustments', { user: u(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });

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
        // ── Montaje: jornada de Jose, una resuelta, y RELEVO a Carlos ────────
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await routes.update({ user_id: JOSE }, { where: { id: RID } });
        await call(rutasCtrl, 'startRoute', { user: u(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });
        const total = (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n;
        const p = await q(`SELECT id, store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 2`, { r: RID, d: hoy });
        await call(tiendasCtrl, 'updateStoreAsVisited', { user: u(JOSE), params: { store_id: String(p[0].store_id) }, body: { distance: 5, route_id: RID } });
        await call(rutasCtrl, 'updateRoute', { user: u(CARLOS, 'owner'), params: { id: String(RID) }, body: { name: 'Ruta Carolina - Quito Lopéz', user_id: CARLOS } });

        const dueños = (await q(`SELECT count(DISTINCT user_id)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n;
        check('la jornada quedó repartida entre DOS usuarios', dueños === 2, String(dueños));

        console.log('\n1️⃣  Una jornada por DÍA, no una por persona');
        let r = await diagnostico();
        check('reporta UNA sola jornada para hoy', r.body.jornadas.length === 1, JSON.stringify(r.body.jornadas.map(j => j.responsable.user_name)));
        check('sin faltantes fantasma', r.body.total_faltantes === 0, String(r.body.total_faltantes));
        check('el botón no muestra contador', r.body.requiere_ajuste === false);
        check('el responsable es el encargado ACTUAL', /Carlos/.test(r.body.jornadas[0].responsable.user_name || ''), JSON.stringify(r.body.jornadas[0].responsable));

        console.log('\n2️⃣  Un faltante REAL sí se detecta, aun con la jornada repartida');
        await sequelize.query(`DELETE FROM store_visits WHERE id=:id`, { replacements: { id: p[1].id } });
        r = await diagnostico();
        check('exactamente 1 faltante', r.body.total_faltantes === 1, String(r.body.total_faltantes));
        check('es la tienda correcta', r.body.jornadas[0].faltantes[0].store_id === p[1].store_id);

        r = await call(rutasCtrl, 'applyRouteAdjustments', {
            user: u(CARLOS, 'owner'), params: { route_id: String(RID) },
            body: { agregar: [{ visit_day: hoy, store_id: p[1].store_id }] },
        });
        check('se agrega de verdad', r.body.agregadas.length === 1 && r.body.omitidas.length === 0, JSON.stringify(r.body));
        check('la jornada vuelve al total', (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n === total);

        const nueva = (await q(`SELECT user_id::text, user_name FROM store_visits WHERE route_id=:r AND store_id=:s AND visit_day=CAST(:d AS date)`, { r: RID, s: p[1].store_id, d: hoy }))[0];
        check('la parada nueva nace a nombre del encargado ACTUAL', nueva.user_id === CARLOS, nueva.user_id);
        check('con su nombre', /Carlos/.test(nueva.user_name || ''), String(nueva.user_name));

        console.log('\n3️⃣  Y la parada del vendedor anterior sigue intacta');
        const deJose = (await q(`SELECT user_id::text, status FROM store_visits WHERE id=:id`, { id: p[0].id }))[0];
        check('sigue siendo de Jose y visitada', deJose.user_id === JOSE && deJose.status === 'visited', JSON.stringify(deJose));

        r = await diagnostico();
        check('tras ajustar ya no pide nada', r.body.requiere_ajuste === false);
    } finally {
        console.log('\n4️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, user_id::text, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.user_id === respaldo[i].user_id && f.status === respaldo[i].status), `${fin.length} filas`);
    check('ruta con su encargado original', (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id === asignadoOriginal);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
