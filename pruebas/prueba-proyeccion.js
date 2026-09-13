require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Los TRES estados de la tarjeta + que el admin vea el progreso real.
 *
 * ⚠️ La jornada de hoy puede ser REAL (del usuario trabajando en la app). Por eso el script
 * hace un RESPALDO literal de las filas de `store_visits` de hoy y las devuelve tal cual al
 * final, en vez de borrar por rango — que fue justo el error que destruyó una jornada real.
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, store_visits } = require(path + 'models');
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
const tarjetas = (u) => call(tiendasCtrl, 'getStoresbyRoute', { user: u, params: { route_id: String(RID) }, body: {} });
const conteo = (stores) => stores.reduce((a, s) => (a[s.current_visit_status] = (a[s.current_visit_status] || 0) + 1, a), {});

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy`);

    // ── RESPALDO literal de la jornada de hoy ────────────────────────────────
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas antes de tocar nada\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        for (const fila of respaldo) {
            const cols = columnas.map((c) => `"${c}"`).join(', ');
            const vals = columnas.map((c) => `:${c}`).join(', ');
            await sequelize.query(`INSERT INTO store_visits (${cols}) VALUES (${vals})`, { replacements: fila });
        }
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('store_visits','id'), (SELECT max(id) FROM store_visits))`);
    };

    try {
        // ── 1. Sin jornada ───────────────────────────────────────────────────
        console.log('1️⃣  RUTA SIN INICIAR → todo pendiente (ahí el mensaje "primero inicia la ruta" sí aplica)');
        await sequelize.query(`DELETE FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date)`, { replacements: { r: RID, d: hoy } });
        let r = await tarjetas(usuario(CARLOS, 'owner'));
        let c = conteo(r.body.stores);
        check('todas en pending', c.pending === r.body.stores.length, JSON.stringify(c));
        check('ninguna sin_parada', !c.sin_parada);

        // ── 2. Jornada + tienda fuera ────────────────────────────────────────
        console.log('\n2️⃣  RUTA INICIADA y una tienda fuera de la jornada');
        await call(rutasCtrl, 'startRoute', { user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });
        const fuera = (await q(`SELECT id, store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id DESC LIMIT 1`, { r: RID, d: hoy }))[0];
        await sequelize.query(`DELETE FROM store_visits WHERE id=:id`, { replacements: { id: fuera.id } });

        r = await tarjetas(usuario(CARLOS, 'owner'));
        c = conteo(r.body.stores);
        const laTienda = r.body.stores.find((s) => s.id === fuera.store_id);
        check('exactamente 1 sin_parada', c.sin_parada === 1, JSON.stringify(c));
        check('es la tienda correcta', laTienda.current_visit_status === 'sin_parada');
        check('sin current_visit_id (no hay qué marcar)', laTienda.current_visit_id === null);
        check('las demás siguen pendientes', c.pending === r.body.stores.length - 1);

        // ── 3. Progreso real ─────────────────────────────────────────────────
        console.log('\n3️⃣  Con progreso: una visitada y una completada');
        const dos = await q(`SELECT id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 2`, { r: RID, d: hoy });
        await store_visits.update({ status: 'visited' }, { where: { id: dos[0].id } });
        await store_visits.update({ status: 'completed' }, { where: { id: dos[1].id } });

        r = await tarjetas(usuario(CARLOS, 'owner'));
        c = conteo(r.body.stores);
        check('proyecta visited y completed', c.visited === 1 && c.completed === 1, JSON.stringify(c));
        check('y mantiene la sin_parada', c.sin_parada === 1);

        // ── 4. Otro usuario ve el progreso real ──────────────────────────────
        console.log('\n4️⃣  Otro usuario ve el progreso REAL (antes veía TODO en pending)');
        r = await tarjetas(usuario(JOSE));
        c = conteo(r.body.stores);
        check('ve la visitada y la completada', c.visited === 1 && c.completed === 1, JSON.stringify(c));
        check('ve la sin_parada', c.sin_parada === 1);

        // ── 5. Ajustar la resuelve ───────────────────────────────────────────
        console.log('\n5️⃣  El botón Ajustar resuelve la sin_parada');
        r = await call(rutasCtrl, 'applyRouteAdjustments', {
            user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) },
            body: { agregar: [{ visit_day: hoy, store_id: fuera.store_id }] }
        });
        check('agregada', r.body.agregadas.length === 1, JSON.stringify(r.body));
        r = await tarjetas(usuario(CARLOS, 'owner'));
        c = conteo(r.body.stores);
        check('ya no queda ninguna sin_parada', !c.sin_parada, JSON.stringify(c));
        check('la tienda vuelve a ser marcable', r.body.stores.find((s) => s.id === fuera.store_id).current_visit_id !== null);
    } finally {
        console.log('\n6️⃣  Restaurando el respaldo');
        await restaurar();
    }

    const fin = await q(`SELECT id, store_id, status FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const igual = fin.length === respaldo.length
        && fin.every((f, i) => f.id === respaldo[i].id && f.store_id === respaldo[i].store_id && f.status === respaldo[i].status);
    check(`la jornada vuelve idéntica (${respaldo.length} paradas, mismos ids y estados)`, igual, `${fin.length} filas`);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('💥', e); process.exit(1); });
