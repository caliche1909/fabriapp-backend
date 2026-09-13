require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 5 — El candado nuevo: una parada por tienda, ruta y día.
 * Comprueba que el hueco de las "listas paralelas" quedó tapado por la BASE DE DATOS,
 * no por una comprobación de la aplicación. Respalda y restaura.
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, routes } = require(path + 'models');
const rutasCtrl = require(path + 'controllers/routes_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const CARLOS = '5f27545a-130d-4b8f-ad07-52c87dc31f4d';
const JOSE = '236b06db-6d05-478a-9cd9-32a8200e267a';

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (m, req) => { const res = mkRes(); await rutasCtrl[m](req, res); return { status: res._s, body: res._j }; };
const owner = { id: CARLOS, companyId: COMPANY, userType: 'owner', companyTimezone: 'America/Bogota', permissions: [] };

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

    console.log('1️⃣  El candado es el correcto');
    const idx = await q(`SELECT indexdef FROM pg_indexes WHERE tablename='store_visits' AND indexname='uq_store_visits_daily'`);
    check('UNIQUE por (store_id, route_id, visit_day)',
        /\(store_id, route_id, visit_day\)/.test(idx[0].indexdef), idx[0].indexdef);
    check('el user_id YA NO forma parte de la identidad', !/user_id/.test(idx[0].indexdef));

    console.log('\n2️⃣  Integridad tras la fusión');
    const t = (await q(`
        SELECT (SELECT count(*)::int FROM sales WHERE visit_id IS NULL) AS ventas_huerfanas,
               (SELECT count(*)::int FROM store_no_sale_reports WHERE visit_id IS NULL) AS reportes_huerfanos,
               (SELECT COALESCE(sum(total_amount),0)::float8 FROM sales) AS importe_ventas,
               (SELECT COALESCE(sum(sale_amount),0)::float8 FROM store_visits) AS monto_visitas,
               (SELECT count(*)::int FROM (SELECT 1 FROM store_visits WHERE route_id IS NOT NULL
                  GROUP BY store_id, route_id, visit_day HAVING count(*)>1) x) AS duplicados`))[0];
    check('ninguna venta quedó sin visita', t.ventas_huerfanas === 0, String(t.ventas_huerfanas));
    check('ningún reporte quedó sin visita', t.reportes_huerfanos === 0, String(t.reportes_huerfanos));
    check('el importe de ventas cuadra con el monto de las visitas', t.importe_ventas === t.monto_visitas, `${t.importe_ventas} vs ${t.monto_visitas}`);
    check('cero duplicados', t.duplicados === 0, String(t.duplicados));

    try {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await routes.update({ user_id: JOSE }, { where: { id: RID } });
        await call('startRoute', { user: owner, params: { route_id: String(RID) }, body: {} });
        const p = (await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 1`, { r: RID, d: hoy }))[0];

        console.log('\n3️⃣  La BASE DE DATOS impide la lista paralela');
        let reventó = false;
        try {
            await sequelize.query(
                `INSERT INTO store_visits (user_id, store_id, route_id, visit_day, status, user_name, store_name, store_address, route_name, sale_amount, date, created_at, updated_at)
                 VALUES (CAST(:u AS uuid), :s, :r, CAST(:d AS date), 'pending', 'Intruso', :sn, :sa, :rn, 0, now(), now(), now())`,
                { replacements: { u: CARLOS, s: p.store_id, r: RID, d: hoy, sn: p.store_name, sa: p.store_address, rn: p.route_name } });
        } catch (e) {
            reventó = /unique|uq_store_visits_daily/i.test(e.message || '');
        }
        check('una segunda parada de la misma tienda/día con OTRO usuario → rechazada', reventó);

        console.log('\n4️⃣  Lo que SÍ debe seguir funcionando');
        let r = await call('startRoute', { user: owner, params: { route_id: String(RID) }, body: {} });
        check('re-iniciar sigue siendo idempotente', r.status === 200 && r.body.already_started === true, JSON.stringify(r.body.message));

        const [{ manana }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date + 1,'YYYY-MM-DD') AS manana`);
        r = await call('startRoute', { user: owner, params: { route_id: String(RID) }, body: { visit_day: manana } });
        check('la misma tienda en OTRO día sí se puede', r.status === 200 && r.body.visitas_del_dia > 0, JSON.stringify(r.body.message));
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: manana } });

        r = await call('updateRoute', {
            user: owner, params: { id: String(RID) },
            body: { name: 'Ruta Carolina - Quito Lopéz', user_id: CARLOS },
        });
        check('el relevo del paso 4 sigue traspasando', r.body.relevo.visitas_traspasadas > 0, JSON.stringify(r.body.relevo));
    } finally {
        console.log('\n5️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.status === respaldo[i].status), `${fin.length} filas`);
    check('ruta con su encargado original', (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id === asignadoOriginal);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
