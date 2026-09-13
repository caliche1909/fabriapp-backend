require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// MODO 1 (sin inventario): ¿los datos que guarda la venta responden las preguntas del negocio?
//   a) ¿Qué se vendió cada día, de cada producto?
//   b) ¿Cuánto se vende en promedio por día (para planear producción)?
//   c) ¿Qué compra cada tienda?
// Crea ventas de prueba, corre las consultas reales y borra todo lo que creó.
const { sequelize, sales, sale_items, companies, products } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };
const TZ = 'America/Bogota';

(async () => {
    const ventasCreadas = [];
    const prodsCreados = [];
    let COMPANY = null, modoOriginal = null;
    try {
        const [comp] = await q(`SELECT id, name, sales_inventory_mode modo, timezone FROM companies WHERE EXISTS (SELECT 1 FROM stores s WHERE s.company_id=companies.id) ORDER BY name LIMIT 1`);
        COMPANY = comp.id; modoOriginal = comp.modo;
        const [{ id: ownerId }] = await q(`SELECT user_id id FROM user_companies WHERE company_id=:c AND user_type='owner' LIMIT 1`, { c: COMPANY });
        const tiendas = await q(`SELECT id, name FROM stores WHERE company_id=:c ORDER BY id LIMIT 2`, { c: COMPANY });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: COMPANY });
        await companies.update({ sales_inventory_mode: 'sin_inventario' }, { where: { id: COMPANY } });

        // Dos productos de prueba con precio y costo conocidos.
        for (const [n, precio, costo] of [['ZZZ Pan de prueba', 1000, 400], ['ZZZ Torta de prueba', 5000, 2000]]) {
            const [p] = await q(`
                INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
                VALUES (:c, :n, :sku, :precio, :costo, 0, true, now(), now()) RETURNING id`,
                { c: COMPANY, n, sku: `TEST-${n.slice(4, 12).toUpperCase()}`, precio, costo });
            prodsCreados.push({ id: p.id, name: n, precio, costo });
        }
        const [pan, torta] = prodsCreados;
        const user = { id: ownerId, companyId: COMPANY, userType: 'owner', permissions: [], companySalesInventoryMode: 'sin_inventario' };

        console.log(`\nCompañía "${comp.name}" (TZ ${comp.timezone}) · tiendas: ${tiendas.map((t) => t.name).join(' / ')}\n`);

        // ── 1. El catálogo es lo único que necesita el modo 1 ────────────────────
        console.log('1) Lo que necesita el modo 1: la lista de productos creada');
        let r = res(); await ctrl.getPosCatalog({ user }, r);
        ok(r._p.items.some((i) => i.product_id === pan.id) && r._p.items.some((i) => i.product_id === torta.id),
            'los productos recién creados ya aparecen en el POS (sin cargar stock ni crear bodegas)');
        ok(r._p.location === null && r._p.bloqueo === null, 'no pide bodega ni bloquea nada');

        // ── 2. Ventas: 2 tiendas, 2 productos ────────────────────────────────────
        console.log('\n2) Registrar ventas del día');
        const registrar = async (tienda, items) => {
            const rr = res();
            await ctrl.createSale({ user, body: { store_id: tienda.id, payment_method_id: pago.id, items } }, rr);
            if (rr._p?.data?.id) ventasCreadas.push(rr._p.data.id);
            return rr;
        };
        r = await registrar(tiendas[0], [{ product_id: pan.id, quantity: 10 }, { product_id: torta.id, quantity: 2 }]);
        ok(r._c === 201 && r._p.data.total_amount === 10 * 1000 + 2 * 5000, `tienda 1: 10 panes + 2 tortas = ${r._p.data?.total_amount}`);
        r = await registrar(tiendas[0], [{ product_id: pan.id, quantity: 5 }]);
        ok(r._c === 201, 'tienda 1: segunda venta del día (5 panes) — se permiten varias');
        r = await registrar(tiendas[1] || tiendas[0], [{ product_id: torta.id, quantity: 3 }]);
        ok(r._c === 201, `tienda 2: 3 tortas`);

        const ids = ventasCreadas;
        const filtro = `sa.id IN (${ids.join(',')})`;

        // ── 3. ¿Qué se vendió cada día, de cada producto? ────────────────────────
        console.log('\n3) ¿Qué se vende cada día, de cada producto?');
        const porDia = await q(`
            SELECT (sa.sale_date AT TIME ZONE :tz)::date AS dia,
                   si.product_id, si.product_name,
                   sum(si.quantity)::float8   AS unidades,
                   sum(si.total_price)::float8 AS importe,
                   sum(si.quantity * si.unit_cost)::float8 AS costo
              FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
             WHERE ${filtro} AND sa.deleted_at IS NULL
             GROUP BY 1,2,3 ORDER BY 1, 4 DESC`, { tz: TZ });
        console.table(porDia.map((f) => ({ dia: String(f.dia).slice(0, 10), producto: f.product_name, unidades: f.unidades, importe: f.importe, costo: f.costo })));
        const panDia = porDia.find((f) => f.product_id === pan.id);
        const tortaDia = porDia.find((f) => f.product_id === torta.id);
        ok(panDia?.unidades === 15, `pan: 10 + 5 = ${panDia?.unidades} unidades en el día (suma las 2 ventas)`);
        ok(tortaDia?.unidades === 5, `torta: 2 + 3 = ${tortaDia?.unidades} unidades (suma las 2 tiendas)`);
        ok(panDia?.importe === 15000 && panDia?.costo === 6000, `pan: importe ${panDia?.importe} y costo ${panDia?.costo} → margen calculable`);

        // ── 4. Promedio diario por producto (base para producción) ───────────────
        console.log('\n4) Promedio de venta por día (para planear producción)');
        const promedio = await q(`
            WITH por_dia AS (
                SELECT si.product_id, si.product_name,
                       (sa.sale_date AT TIME ZONE :tz)::date AS dia,
                       sum(si.quantity) AS unidades
                  FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
                 WHERE ${filtro} AND sa.deleted_at IS NULL
                 GROUP BY 1,2,3)
            SELECT product_name, count(*)::int AS dias, sum(unidades)::float8 AS total,
                   round(avg(unidades), 2)::float8 AS promedio_diario
              FROM por_dia GROUP BY 1 ORDER BY 3 DESC`, { tz: TZ });
        console.table(promedio);
        ok(promedio.length === 2 && promedio.every((p) => p.promedio_diario > 0), 'se puede promediar por producto y por día');

        // ── 5. ¿Qué compra cada tienda? ──────────────────────────────────────────
        console.log('\n5) ¿Qué compra cada tienda?');
        const porTienda = await q(`
            SELECT st.name AS tienda, si.product_name,
                   sum(si.quantity)::float8 AS unidades,
                   sum(si.total_price)::float8 AS importe,
                   count(DISTINCT sa.id)::int AS ventas
              FROM sale_items si
              JOIN sales sa ON sa.id = si.sale_id
              JOIN stores st ON st.id = sa.store_id
             WHERE ${filtro} AND sa.deleted_at IS NULL
             GROUP BY 1,2 ORDER BY 1,4 DESC`, { tz: TZ });
        console.table(porTienda);
        ok(porTienda.length >= 2, 'se puede desglosar qué producto compra cada tienda y cuánto');

        // ── 6. Integridad de lo guardado ─────────────────────────────────────────
        console.log('\n6) Integridad de lo que quedó guardado');
        const [chk] = await q(`
            SELECT count(*)::int items,
                   count(*) FILTER (WHERE si.product_name IS NULL)::int sin_nombre,
                   count(*) FILTER (WHERE si.unit_cost IS NULL)::int sin_costo,
                   count(*) FILTER (WHERE si.company_id IS NULL)::int sin_compania,
                   count(*) FILTER (WHERE sa.location_id IS NOT NULL)::int con_bodega,
                   count(*) FILTER (WHERE sa.sale_date IS NULL)::int sin_fecha
              FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE ${filtro}`);
        ok(chk.items === 4, `${chk.items} líneas guardadas (una por producto de cada venta)`);
        ok(chk.sin_nombre === 0, 'todas con el NOMBRE del producto congelado (sobreviven a un renombrado o borrado)');
        ok(chk.sin_costo === 0, 'todas con el COSTO de producción congelado (margen histórico correcto)');
        ok(chk.sin_compania === 0 && chk.sin_fecha === 0, 'todas con compañía y fecha (consultas por tenant y por día)');
        ok(chk.con_bodega === 0, 'ninguna venta quedó ligada a una bodega (es el modo sin inventario)');
        const [mov] = await q(`SELECT count(*)::int n FROM product_stock_movements WHERE reference_type='sale' AND reference_id IN (${ids.join(',')})`);
        ok(mov.n === 0, 'y no se creó ningún movimiento de inventario');
    } finally {
        for (const id of ventasCreadas) {
            await sale_items.destroy({ where: { sale_id: id }, force: true });
            await sales.destroy({ where: { id }, force: true, userId: 'limpieza' });
        }
        for (const p of prodsCreados) await products.destroy({ where: { id: p.id }, force: true });
        if (COMPANY && modoOriginal) await companies.update({ sales_inventory_mode: modoOriginal }, { where: { id: COMPANY } });
        const [sobras] = await q(`SELECT (SELECT count(*)::int FROM products WHERE sku LIKE 'TEST-%') p, (SELECT count(*)::int FROM sale_items WHERE product_name LIKE 'ZZZ%') i`);
        console.log(`\n🧹 Limpieza: ${ventasCreadas.length} ventas y ${prodsCreados.length} productos de prueba borrados · sobras: ${sobras.p} productos, ${sobras.i} líneas · modo "${modoOriginal}"`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
