require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Motor de ajuste de jornadas (ruta 32).
 *
 * Monta su PROPIO escenario y respalda/restaura la jornada de hoy literal: no depende del
 * estado que haya en la base ni deja rastro. (La versión anterior fijaba la tienda 438 y un
 * responsable concreto, y se volvía roja en cuanto el usuario tocaba la app.)
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, store_visits } = require(path + 'models');
const ctrl = require(path + 'controllers/routes_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const OWNER = '5f27545a-130d-4b8f-ad07-52c87dc31f4d';

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (m, req) => { const res = mkRes(); await ctrl[m](req, res); return { status: res._s, body: res._j }; };
const req = (user, body = {}, params = {}) => ({ user, params: { route_id: String(RID), ...params }, body });

const owner = { id: OWNER, companyId: COMPANY, userType: 'owner', companyTimezone: 'America/Bogota', permissions: [] };
const admin = { id: '00000000-0000-0000-0000-000000000002', companyId: COMPANY, userType: 'collaborator', companyTimezone: 'America/Bogota', permissions: ['start_route_for_others'] };
const ajeno = { id: '00000000-0000-0000-0000-000000000003', companyId: COMPANY, userType: 'collaborator', companyTimezone: 'America/Bogota', permissions: [] };

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        for (const fila of respaldo) {
            const cols = columnas.map(c => `"${c}"`).join(', ');
            const vals = columnas.map(c => `:${c}`).join(', ');
            await sequelize.query(`INSERT INTO store_visits (${cols}) VALUES (${vals})`, { replacements: fila });
        }
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('store_visits','id'), (SELECT max(id) FROM store_visits))`);
    };
    const contar = async () => (await q(`SELECT count(*)::int AS n FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { r: RID, d: hoy }))[0].n;
    const revincular = (id, sid) => sequelize.query(
        `INSERT INTO routes_stores (id, route_id, store_id, company_id, created_at, updated_at) VALUES (:id,:r,:s,:c, now(), now())`,
        { replacements: { id, r: RID, s: sid, c: COMPANY } });

    try {
        // ── Escenario propio: jornada limpia menos una parada (la "faltante") ────
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        await call('startRoute', req(owner));
        const total = await contar();
        const fuera = (await q(`SELECT id, store_id, store_name FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id DESC LIMIT 1`, { r: RID, d: hoy }))[0];
        await sequelize.query(`DELETE FROM store_visits WHERE id=:id`, { replacements: { id: fuera.id } });
        const responsable = (await q(`SELECT user_id::text, user_name FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) LIMIT 1`, { r: RID, d: hoy }))[0];

        console.log(`1️⃣  Diagnóstico (falta la parada de "${fuera.store_name}")`);
        let r = await call('getRouteAdjustments', req(owner));
        const j0 = r.body.jornadas[0];
        check('responde 200', r.status === 200);
        check('detecta 1 jornada abierta', r.body.jornadas.length === 1, String(r.body.jornadas.length));
        check('la jornada es la de hoy', j0.visit_day === hoy && j0.es_hoy === true);
        check('el responsable sale de la jornada', j0.responsable.user_id === responsable.user_id, j0.responsable.user_id);
        check('1 faltante y es la tienda esperada', j0.faltantes.length === 1 && j0.faltantes[0].store_id === fuera.store_id, JSON.stringify(j0.faltantes));
        check('sin sobrantes', j0.sobrantes.length === 0);
        check('requiere_ajuste = true', r.body.requiere_ajuste === true);

        console.log('\n2️⃣  Aplicar: agregar la visita faltante');
        r = await call('applyRouteAdjustments', req(owner, { agregar: [{ visit_day: hoy, store_id: fuera.store_id }] }));
        check('responde 200', r.status === 200, JSON.stringify(r.body));
        check('reporta 1 agregada', r.body.agregadas.length === 1);
        check('sin omitidas', r.body.omitidas.length === 0, JSON.stringify(r.body.omitidas));
        check('la jornada vuelve al total', (await contar()) === total);

        const nueva = (await q(`SELECT * FROM store_visits WHERE route_id=:r AND store_id=:s AND visit_day=CAST(:d AS date)`, { r: RID, s: fuera.store_id, d: hoy }))[0];
        check('la parada nace en pending', nueva.status === 'pending');
        check('a nombre del responsable de la jornada', nueva.user_id === responsable.user_id, nueva.user_id);
        check('congela store_name / store_address / route_name', !!nueva.store_name && !!nueva.store_address && !!nueva.route_name);
        check('user_name desnormalizado', !!nueva.user_name);
        check('sale_amount en 0', Number(nueva.sale_amount) === 0);
        check('optimized_seq nulo (va al final de las pendientes)', nueva.optimized_seq === null);
        check('date cae en el día de la jornada',
            (await q(`SELECT ((date AT TIME ZONE 'America/Bogota')::date = visit_day) AS ok FROM store_visits WHERE id=:id`, { id: nueva.id }))[0].ok === true);

        console.log('\n3️⃣  Idempotencia');
        const n2 = await contar();
        r = await call('applyRouteAdjustments', req(owner, { agregar: [{ visit_day: hoy, store_id: fuera.store_id }] }));
        check('no duplica paradas', (await contar()) === n2);
        check('lo reporta como omitido con motivo', r.body.omitidas.length === 1, JSON.stringify(r.body.omitidas));

        r = await call('getRouteAdjustments', req(owner));
        check('ya no requiere ajuste', r.body.requiere_ajuste === false);
        check('sigue viendo la jornada abierta', r.body.hay_jornadas === true);

        console.log('\n4️⃣  Tienda que SALE de la ruta con parada pendiente');
        const victima = (await q(`SELECT sv.store_id, sv.id AS visit_id FROM store_visits sv
              WHERE sv.route_id=:r AND sv.visit_day=CAST(:d AS date) AND sv.status='pending' AND sv.store_id <> :s
              ORDER BY sv.id LIMIT 1`, { r: RID, d: hoy, s: fuera.store_id }))[0];
        const vinculo = (await q(`SELECT * FROM routes_stores WHERE route_id=:r AND store_id=:s`, { r: RID, s: victima.store_id }))[0];
        await sequelize.query(`DELETE FROM routes_stores WHERE id=:id`, { replacements: { id: vinculo.id } });

        r = await call('getRouteAdjustments', req(owner));
        check('aparece como sobrante', r.body.jornadas[0].sobrantes.some(s => s.visit_id === victima.visit_id), JSON.stringify(r.body.jornadas[0].sobrantes));
        check('no aparece como faltante', r.body.jornadas[0].faltantes.length === 0);

        r = await call('applyRouteAdjustments', req(owner, { quitar: [victima.visit_id] }));
        check('reporta 1 quitada', r.body.quitadas.length === 1, JSON.stringify(r.body));
        check('la parada se borró de verdad (hard delete)', (await q(`SELECT id FROM store_visits WHERE id=:id`, { id: victima.visit_id })).length === 0);

        await revincular(vinculo.id, victima.store_id);
        r = await call('applyRouteAdjustments', req(owner, { agregar: [{ visit_day: hoy, store_id: victima.store_id }] }));
        check('se puede volver a agregar tras re-vincular', r.body.agregadas.length === 1, JSON.stringify(r.body));

        console.log('\n5️⃣  Parada YA VISITADA de una tienda desvinculada → bloqueada');
        const v2 = (await q(`SELECT sv.store_id, sv.id AS visit_id FROM store_visits sv
              WHERE sv.route_id=:r AND sv.visit_day=CAST(:d AS date) AND sv.status='pending' AND sv.store_id NOT IN (:a, :b)
              ORDER BY sv.id LIMIT 1`, { r: RID, d: hoy, a: fuera.store_id, b: victima.store_id }))[0];
        const vinc2 = (await q(`SELECT * FROM routes_stores WHERE route_id=:r AND store_id=:s`, { r: RID, s: v2.store_id }))[0];
        await store_visits.update({ status: 'visited' }, { where: { id: v2.visit_id } });
        await sequelize.query(`DELETE FROM routes_stores WHERE id=:id`, { replacements: { id: vinc2.id } });

        r = await call('getRouteAdjustments', req(owner));
        check('va a bloqueadas, no a sobrantes',
            r.body.jornadas[0].bloqueadas.some(b => b.visit_id === v2.visit_id) && r.body.jornadas[0].sobrantes.length === 0,
            JSON.stringify({ b: r.body.jornadas[0].bloqueadas, s: r.body.jornadas[0].sobrantes }));

        r = await call('applyRouteAdjustments', req(owner, { quitar: [v2.visit_id] }));
        check('si igual se pide borrarla, se omite', r.body.quitadas.length === 0 && r.body.omitidas.length === 1, JSON.stringify(r.body));
        check('la parada visitada sigue viva', (await q(`SELECT id FROM store_visits WHERE id=:id`, { id: v2.visit_id })).length === 1);
        await revincular(vinc2.id, v2.store_id);

        console.log('\n6️⃣  Autorización');
        r = await call('getRouteAdjustments', req(admin));
        check('un admin con start_route_for_others ve la jornada', r.body.hay_jornadas === true);
        r = await call('getRouteAdjustments', req(ajeno));
        check('un colaborador sin permiso NO la ve', r.body.hay_jornadas === false && r.body.jornadas.length === 0);
        r = await call('applyRouteAdjustments', req(ajeno, { agregar: [{ visit_day: hoy, store_id: fuera.store_id }] }));
        check('y no puede aplicar nada', r.body.agregadas.length === 0 && r.body.omitidas.length === 1, JSON.stringify(r.body));

        console.log('\n7️⃣  Aislamiento multi-compañía y validaciones');
        r = await call('getRouteAdjustments', req({ ...owner, companyId: '00000000-0000-0000-0000-0000000000ff' }));
        check('ruta de otra compañía → 404', r.status === 404);
        r = await call('applyRouteAdjustments', req(owner, {}));
        check('cuerpo vacío → 400', r.status === 400);
        r = await call('getRouteAdjustments', req(owner, {}, { route_id: 'abc' }));
        check('id inválido → 400', r.status === 400);
    } finally {
        console.log('\n8️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, store_id, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.status === respaldo[i].status), `${fin.length} filas`);
    check('todas las tiendas siguen vinculadas',
        (await q(`SELECT count(*)::int AS n FROM routes_stores WHERE route_id=:r`, { r: RID }))[0].n >= respaldo.length);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
