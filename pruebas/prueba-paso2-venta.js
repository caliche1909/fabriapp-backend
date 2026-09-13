require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * PASO 2 — Venta y no-venta bajo la regla del encargado, con relevo a media jornada.
 * Respalda la jornada y borra lo que crea (ventas, ítems, reportes) por id.
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize, routes } = require(path + 'models');
const rutasCtrl = require(path + 'controllers/routes_controller');
const tiendasCtrl = require(path + 'controllers/stores_controller');
const ventasCtrl = require(path + 'controllers/sales_controller');
const noVentaCtrl = require(path + 'controllers/store_no_sale_reports_controller');
sequelize.options.logging = false;

const RID = 32, COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const CARLOS = '5f27545a-130d-4b8f-ad07-52c87dc31f4d';
const JOSE = '236b06db-6d05-478a-9cd9-32a8200e267a';
const PAGO = 1;
// El producto se crea al vuelo: `products` puede estar vacia (en produccion la crean las
// migraciones) y un id fijo hace fallar la venta con "el producto no existe".
let PRODUCTO = null;

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = { _s: null, _j: null }; r.status = s => { r._s = s; return r; }; r.json = j => { r._j = j; return r; }; return r; };
const call = async (c, m, req) => { const res = mkRes(); await c[m](req, res); return { status: res._s, body: res._j }; };
const usuario = (id, tipo = 'collaborator') => ({
    id, companyId: COMPANY, userType: tipo, companyTimezone: 'America/Bogota',
    permissions: [], companySalesInventoryMode: 'sin_inventario',
});
const marcar = (u, storeId) => call(tiendasCtrl, 'updateStoreAsVisited',
    { user: u, params: { store_id: String(storeId) }, body: { distance: 5, route_id: RID } });
const vender = (u, storeId, visitId, cantidad = 2) => call(ventasCtrl, 'createSale', {
    user: u, params: {},
    body: { store_id: storeId, payment_method_id: PAGO, route_id: RID, visit_id: visitId, items: [{ product_id: PRODUCTO, quantity: cantidad }] },
});
const reportarNoVenta = (u, storeId, visitId) => call(noVentaCtrl, 'createNoSaleReport', {
    user: u, params: {},
    body: { visit_id: visitId, store_id: storeId, route_id: RID, category_id: 1, reason_id: 1, comments: 'prueba automatizada' },
});

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${d ? ' → ' + d : ''}`); } };

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE 'America/Bogota')::date,'YYYY-MM-DD') AS hoy`);
    const respaldo = await q(`SELECT * FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    const columnas = respaldo.length ? Object.keys(respaldo[0]) : [];
    const asignadoOriginal = (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id;
    const maxProducto = (await q(`SELECT COALESCE(max(id),0)::int AS n FROM products`))[0].n;
    PRODUCTO = (await q(
        `INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
         VALUES (:c, 'ZZZ Producto de prueba paso2', 'TEST-PASO2', 2500, 1000, 0, true, now(), now()) RETURNING id`,
        { c: COMPANY }))[0].id;
    const maxVenta = (await q(`SELECT COALESCE(max(id),0)::int AS n FROM sales`))[0].n;
    const maxReporte = (await q(`SELECT COALESCE(max(id),0)::int AS n FROM store_no_sale_reports`))[0].n;
    console.log(`\n📅 ${hoy} — respaldadas ${respaldo.length} paradas; ventas hasta id ${maxVenta}\n`);

    const restaurar = async () => {
        await sequelize.query(`DELETE FROM store_no_sale_reports WHERE id > :n`, { replacements: { n: maxReporte } });
        await sequelize.query(`DELETE FROM sale_items WHERE sale_id > :n`, { replacements: { n: maxVenta } });
        await sequelize.query(`DELETE FROM products WHERE id > :n`, { replacements: { n: maxProducto } });
        await sequelize.query(`DELETE FROM sales WHERE id > :n`, { replacements: { n: maxVenta } });
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
        await call(rutasCtrl, 'startRoute', { user: usuario(CARLOS, 'owner'), params: { route_id: String(RID) }, body: {} });
        const p = await q(`SELECT id, store_id FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id LIMIT 5`, { r: RID, d: hoy });

        console.log('1️⃣  Venta: solo el encargado');
        await marcar(usuario(JOSE), p[0].store_id);
        let r = await vender(usuario(CARLOS, 'owner'), p[0].store_id, p[0].id);
        check('el OWNER no encargado NO puede vender', r.status === 403, `${r.status}: ${r.body.message}`);
        check('el mensaje nombra al encargado', /Jose luis/.test(r.body.message || ''), r.body.message);

        r = await vender(usuario(JOSE), p[0].store_id, p[0].id);
        check('el ENCARGADO vende', r.status === 201, `${r.status}: ${r.body.message}`);
        let v = (await q(`SELECT status, sale_amount::float8 AS monto, user_id::text FROM store_visits WHERE id=:id`, { id: p[0].id }))[0];
        check('la visita queda completed', v.status === 'completed', v.status);
        check('acumula el monto (2 x 2500)', v.monto === 5000, String(v.monto));

        console.log('\n2️⃣  Venta con una visita de OTRA tienda');
        r = await vender(usuario(JOSE), p[1].store_id, p[0].id);
        check('rechazada con 400', r.status === 400, `${r.status}: ${r.body.message}`);

        console.log('\n3️⃣  RELEVO: Jose llegó a una tienda, Carlos toma la ruta y cierra la venta');
        await marcar(usuario(JOSE), p[2].store_id);   // Jose LLEGA
        const antes = (await q(`SELECT user_id::text, status FROM store_visits WHERE id=:id`, { id: p[2].id }))[0];
        check('la parada quedó a nombre de Jose (él llegó)', antes.user_id === JOSE && antes.status === 'visited');

        await routes.update({ user_id: CARLOS }, { where: { id: RID } });   // RELEVO

        r = await vender(usuario(JOSE), p[2].store_id, p[2].id);
        check('el encargado ANTERIOR ya no puede vender', r.status === 403, `${r.status}: ${r.body.message}`);

        r = await vender(usuario(CARLOS, 'owner'), p[2].store_id, p[2].id, 3);
        check('el NUEVO encargado SÍ cierra la venta de esa parada', r.status === 201, `${r.status}: ${r.body.message}`);

        v = (await q(`SELECT status, sale_amount::float8 AS monto, user_id::text FROM store_visits WHERE id=:id`, { id: p[2].id }))[0];
        check('la visita se cerró de verdad (no un no-op silencioso)', v.status === 'completed', v.status);
        check('el monto se acumuló (3 x 2500)', v.monto === 7500, String(v.monto));
        check('la parada SIGUE a nombre de quien LLEGÓ (Jose)', v.user_id === JOSE, v.user_id);

        const laVenta = (await q(`SELECT user_id::text FROM sales WHERE visit_id=:id ORDER BY id DESC LIMIT 1`, { id: p[2].id }))[0];
        check('y la venta a nombre de quien VENDIÓ (Carlos)', laVenta.user_id === CARLOS, laVenta.user_id);

        console.log('\n4️⃣  Reporte de no-venta: antes NO validaba nada');
        await marcar(usuario(CARLOS, 'owner'), p[3].store_id);
        r = await reportarNoVenta(usuario(JOSE), p[3].store_id, p[3].id);
        check('un NO encargado ya no puede reportar', r.status === 403, `${r.status}: ${r.body.message}`);

        r = await reportarNoVenta(usuario(CARLOS, 'owner'), p[3].store_id, p[3].id);
        check('el encargado sí reporta', r.status === 201, `${r.status}: ${r.body.message}`);
        v = (await q(`SELECT status, sale_amount::float8 AS monto FROM store_visits WHERE id=:id`, { id: p[3].id }))[0];
        check('cierra la visita en completed con monto 0', v.status === 'completed' && v.monto === 0, JSON.stringify(v));

        console.log('\n5️⃣  Reglas que no deben aflojarse');
        r = await reportarNoVenta(usuario(CARLOS, 'owner'), p[2].store_id, p[2].id);
        check('no-venta sobre una visita YA vendida → 409', r.status === 409, `${r.status}: ${r.body.message}`);
        r = await vender(usuario(CARLOS, 'owner'), p[3].store_id, p[3].id);
        check('venta sobre una visita YA con no-venta → 409', r.status === 409, `${r.status}: ${r.body.message}`);
        r = await vender(usuario(CARLOS, 'owner'), p[4].store_id, 999999);
        check('visita inexistente → 403', r.status === 403, `${r.status}: ${r.body.message}`);

        console.log('\n6️⃣  Venta suelta (sin visita): sigue permitida');
        r = await call(ventasCtrl, 'createSale', {
            user: usuario(JOSE), params: {},
            body: { store_id: p[4].store_id, payment_method_id: PAGO, items: [{ product_id: PRODUCTO, quantity: 1 }] },
        });
        check('se registra sin regla de ruta', r.status === 201, `${r.status}: ${r.body.message}`);
    } finally {
        console.log('\n7️⃣  Restaurando');
        await restaurar();
    }

    const fin = await q(`SELECT id, user_id::text, status, sale_amount::float8 AS m FROM store_visits WHERE route_id=:r AND visit_day=CAST(:d AS date) ORDER BY id`, { r: RID, d: hoy });
    check(`jornada idéntica (${respaldo.length} paradas)`,
        fin.length === respaldo.length && fin.every((f, i) => f.id === respaldo[i].id && f.status === respaldo[i].status && f.user_id === respaldo[i].user_id),
        `${fin.length} filas`);
    check('sin ventas de prueba residuales', (await q(`SELECT count(*)::int AS n FROM sales WHERE id > :n`, { n: maxVenta }))[0].n === 0);
    check('sin reportes de prueba residuales', (await q(`SELECT count(*)::int AS n FROM store_no_sale_reports WHERE id > :n`, { n: maxReporte }))[0].n === 0);
    check('ruta con su encargado original', (await q(`SELECT user_id::text FROM routes WHERE id=:r`, { r: RID }))[0].user_id === asignadoOriginal);

    console.log(`\n${fail === 0 ? '🎉' : '⚠️'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('💥', e); process.exit(1); });
