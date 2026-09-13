require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Regresión de startRoute: helper compartido, jornada futura y ajuste multi-día.
 * ⚠️ Respalda la jornada de HOY y la devuelve literal (nunca borra por rango sin respaldo).
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize } = require(path + 'models');
const ctrl = require(path + 'controllers/routes_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (m, req) => { const res = mkRes(); await ctrl[m](req, res); return { status: res._s, body: res._j }; };
const owner = { id: '00000000-0000-0000-0000-000000000001', companyId: COMPANY, userType: 'owner', companyTimezone: 'America/Bogota', permissions: [] };
const req = (body = {}) => ({ user: owner, params: { route_id: String(RID) }, body });

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy, futuro }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy,
                                              to_char((now() AT TIME ZONE 'America/Bogota')::date + 3,'YYYY-MM-DD') AS futuro`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    const TOTAL = (await q(`SELECT count(*)::int AS n FROM routes_stores WHERE route_id=:r`, { r: RID }))[0].n;
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas; la ruta tiene ${TOTAL} tiendas\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day IN (CAST(:d AS date), CAST(:f AS date))`,
            { replacements: { r: RID, d: hoy, f: futuro } });
        for (const fila of respaldo) {
            const cols = columnas.map(c => `"${c}"`).join(', ');
            const vals = columnas.map(c => `:${c}`).join(', ');
            await sequelize.query(`INSERT INTO store_visits (${cols}) VALUES (${vals})`, { replacements: fila });
        }
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('store_visits','id'), (SELECT max(id) FROM store_visits))`);
    };

    try {
        // Punto de partida: jornada de hoy completa y sincronizada.
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await call('startRoute', req());

        console.log('1️⃣  Sin desfase pendiente en la jornada de hoy');
        let r = await call('getRouteAdjustments', req());
        check('requiere_ajuste = false', r.body.requiere_ajuste === false, JSON.stringify(r.body.jornadas));

        console.log(`\n2️⃣  Programar la ruta para ${futuro}`);
        r = await call('startRoute', req({ visit_day: futuro }));
        check('responde 200', r.status === 200, JSON.stringify(r.body));
        check(`crea las ${TOTAL} paradas`, r.body.visitas_del_dia === TOTAL, String(r.body.visitas_del_dia));
        check('no la marca como hoy', r.body.is_today === false);

        const fila = (await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) LIMIT 1`, { r: RID, d: futuro }))[0];
        check('campos congelados completos', !!fila.store_name && !!fila.store_address && !!fila.route_name && !!fila.user_name);
        check('nace en pending con sale_amount 0', fila.status === 'pending' && Number(fila.sale_amount) === 0);
        check('date = medianoche del día programado (no now())',
            (await q(`SELECT ((date AT TIME ZONE 'America/Bogota')::date = visit_day) AS ok FROM store_visits WHERE id=:id`, { id: fila.id }))[0].ok === true);

        console.log('\n3️⃣  El diagnóstico ve las DOS jornadas y las evalúa por separado');
        r = await call('getRouteAdjustments', req());
        check('dos jornadas abiertas', r.body.jornadas.length === 2, JSON.stringify(r.body.jornadas.map(j => j.visit_day)));
        check('ambas sincronizadas', r.body.requiere_ajuste === false);

        console.log('\n4️⃣  Una tienda que sale afecta a las dos jornadas a la vez');
        const v = (await q(`SELECT id, store_id FROM routes_stores WHERE route_id=:r ORDER BY id LIMIT 1`, { r: RID }))[0];
        await sequelize.query(`DELETE FROM routes_stores WHERE id=:id`, { replacements: { id: v.id } });
        r = await call('getRouteAdjustments', req());
        check('sobrante en las dos jornadas', r.body.total_sobrantes === 2, String(r.body.total_sobrantes));
        await sequelize.query(`INSERT INTO routes_stores (id, route_id, store_id, company_id, created_at, updated_at)
                               VALUES (:id,:r,:s,:c, now(), now())`,
            { replacements: { id: v.id, r: RID, s: v.store_id, c: COMPANY } });
    } finally {
        console.log('\n5️⃣  Restaurando (jornada futura fuera, jornada de hoy como estaba)');
        await restaurar();
    }

    const fin = await q(`SELECT id, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada de hoy idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.status === respaldo[i].status), `${fin.length} filas`);
    check('sin jornada futura residual',
        (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: futuro }))[0].n === 0);
    check('todas las tiendas vinculadas',
        (await q(`SELECT count(*)::int AS n FROM routes_stores WHERE route_id=:r`, { r: RID }))[0].n === TOTAL);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
