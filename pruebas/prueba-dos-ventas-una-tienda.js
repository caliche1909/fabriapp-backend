require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * DOS VENTAS A LA MISMA TIENDA, hechas sin señal, sincronizando despues.
 *
 * El caso real: el tendero compra y recibe su factura; al rato se acuerda de algo que le faltaba
 * y pide una segunda venta. Las dos se hicieron sin internet y las dos tienen que acabar en
 * Postgres, sumando en la parada.
 *
 * 🔴 TOCA LA BASE DE DATOS. Crea una parada y unas ventas de prueba en 2099 y LO BORRA TODO al
 *    final, incluso si algo falla. No correr contra una BD en uso.
 */
const { sequelize } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const titulo = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

(async () => {
    const creadas = [];
    let visitaId = null;
    try {
        const [comp] = await q(`
            SELECT c.id, c.name FROM companies c
              JOIN products p ON p.company_id = c.id AND p.is_active AND p.sale_price > 0
             GROUP BY c.id ORDER BY count(p.id) DESC LIMIT 1`);
        const [{ id: userId }] = await q(
            `SELECT user_id id FROM user_companies WHERE company_id=:c AND user_type='owner' LIMIT 1`, { c: comp.id });
        const [tienda] = await q(`SELECT id, name FROM stores WHERE company_id=:c LIMIT 1`, { c: comp.id });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: comp.id });
        const prods = await q(`SELECT id, name, sale_price::float8 precio FROM products
                                WHERE company_id=:c AND is_active AND sale_price>0 ORDER BY id LIMIT 2`, { c: comp.id });
        const [pan, otro] = prods;

        const user = { id: userId, companyId: comp.id, userType: 'owner', permissions: [], companySalesInventoryMode: 'sin_inventario' };
        const DIA = '2099-01-16';

        // La parada, ya MARCADA — es la condicion para que el punto de venta se pueda abrir.
        const [v] = await q(`
            INSERT INTO store_visits (user_id, store_id, date, visit_day, status, sale_amount, arrived_at, created_at, updated_at)
            VALUES (:u, :s, now(), :d, 'visited', 0, now(), now(), now()) RETURNING id`,
            { u: userId, s: tienda.id, d: DIA });
        visitaId = v.id;

        console.log(`\nCompañia "${comp.name}" · tienda "${tienda.name}" · parada ${visitaId} MARCADA como visitada`);

        const laParada = async () => (await q(
            `SELECT status, sale_amount::float8 monto FROM store_visits WHERE id=:v`, { v: visitaId }))[0];

        // Cada venta lleva SU uuid, generado una vez en el telefono y repetido en cada reintento.
        const uuid1 = uuid(), uuid2 = uuid();
        // Se declaran como ocurridas por la mañana: es lo que hace el telefono al sincronizar.
        const hace5h = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
        const hace4h = new Date(Date.now() - 4 * 3600 * 1000).toISOString();

        const vender = async (id, cuando, items) => {
            const r = res();
            await ctrl.createSale({
                user,
                body: {
                    store_id: tienda.id, payment_method_id: pago.id, visit_id: visitaId,
                    items, client_operation_id: id, occurred_at: cuando, visit_day: DIA,
                },
            }, r);
            if (r._p?.data?.id && !creadas.includes(r._p.data.id)) creadas.push(r._p.data.id);
            return r;
        };

        // ── 1) La primera venta: la factura que se lleva el tendero ───────────────
        titulo('1) Primera venta (la factura)');
        const total1 = Math.round(2 * pan.precio * 100) / 100;
        const r1 = await vender(uuid1, hace5h, [{ product_id: pan.id, quantity: 2 }]);
        assert(r1._c === 201, `se registra: HTTP ${r1._c}`);
        assert(r1._p.data.total_amount === total1, `por $${total1}`);
        let p = await laParada();
        assert(p.monto === total1, `la parada acumula $${p.monto}`);
        assert(p.status === 'completed', "y queda 'completed'");

        // ── 2) La segunda: se le habia olvidado algo ──────────────────────────────
        titulo('2) Segunda venta a la MISMA tienda (lo que se le olvido)');
        const total2 = Math.round(1 * otro.precio * 100) / 100;
        const r2 = await vender(uuid2, hace4h, [{ product_id: otro.id, quantity: 1 }]);
        assert(r2._c === 201, `tambien se registra: HTTP ${r2._c}`);
        assert(r2._p.data.id !== r1._p.data.id, '🔴 es una venta NUEVA, no pisa a la primera');
        p = await laParada();
        assert(p.monto === total1 + total2,
            `🔴 la parada SUMA las dos: $${total1} + $${total2} = $${p.monto}`);
        assert(r2._p.data.visit_sale_amount === total1 + total2,
            'y el servidor devuelve el acumulado, no solo esta venta');

        titulo('3) Las dos filas estan completas en Postgres');
        const filas = await q(`
            SELECT s.id, s.total_amount::float8 total, s.client_operation_id uuid,
                   s.synced_at IS NOT NULL diferida, s.conflict_reason IS NULL buena,
                   s.deleted_at IS NULL viva,
                   (SELECT count(*)::int FROM sale_items i WHERE i.sale_id = s.id) items,
                   to_char(s.sale_date, 'HH24:MI') hora
              FROM sales s WHERE s.visit_id = :v ORDER BY s.id`, { v: visitaId });
        assert(filas.length === 2, `hay 2 ventas para esta parada: ${filas.length}`);
        assert(filas.every((f) => f.buena && f.viva), 'las DOS cuentan (ninguna apartada ni borrada)');
        assert(filas.every((f) => f.items === 1), 'las dos con su detalle de productos');
        assert(filas[0].uuid === uuid1 && filas[1].uuid === uuid2, 'cada una con SU identificador');
        assert(filas.every((f) => f.diferida),
            '🔴 las dos quedan marcadas como llegadas en diferido (synced_at)');
        assert(filas[0].hora !== filas[1].hora,
            `🔴 y cada una con SU hora real (${filas[0].hora} y ${filas[1].hora}), no la de la sincronizacion`);

        titulo('4) Si la cola reintenta, NO se duplican');
        // Pasa de verdad: la venta llego, la respuesta se perdio y el telefono la reenvia.
        const r1b = await vender(uuid1, hace5h, [{ product_id: pan.id, quantity: 2 }]);
        assert(r1b._c === 200 && r1b._p.code === 'YA_REGISTRADO', 'el reintento responde YA_REGISTRADO');
        assert(r1b._p.data.id === r1._p.data.id, 'y devuelve la venta que ya existia');
        const [cuenta] = await q(`SELECT count(*)::int n FROM sales WHERE visit_id=:v`, { v: visitaId });
        assert(cuenta.n === 2, `siguen siendo 2 ventas, no 3: ${cuenta.n}`);
        p = await laParada();
        assert(p.monto === total1 + total2, `y la parada NO vuelve a sumar: $${p.monto}`);

        titulo('5) El total de la tienda es la suma de las dos');
        const [t] = await q(`SELECT COALESCE(SUM(total_amount),0)::float8 total FROM sales
                              WHERE visit_id=:v AND deleted_at IS NULL`, { v: visitaId });
        assert(t.total === total1 + total2, `$${t.total} = $${total1} + $${total2}`);

    } catch (e) {
        console.error('ERROR:', e.message, e.stack);
        fail++;
    } finally {
        if (creadas.length) {
            await exec(`DELETE FROM sale_items WHERE sale_id IN (:ids)`, { ids: creadas });
            await exec(`DELETE FROM sales WHERE id IN (:ids)`, { ids: creadas });
        }
        if (visitaId) await exec(`DELETE FROM store_visits WHERE id=:v`, { v: visitaId });
        const [s] = await q(`SELECT count(*)::int n FROM store_visits WHERE visit_day='2099-01-16'`);
        console.log(`\n🧹 Limpieza: ${creadas.length} venta(s) y la parada borradas · quedan ${s.n} paradas de prueba (debe ser 0).`);
        console.log('\n=== ' + ok + ' OK · ' + fail + ' FALLAS ===');
        await sequelize.close();
        process.exit(fail ? 1 : 0);
    }
})();
