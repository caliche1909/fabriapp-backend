require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// Prueba del modo "vender sin inventario" + que los otros modos siguen intactos.
// Solo borra lo que crea (las ventas de prueba) y restaura el modo de la compañía.
const { sequelize, sales, sale_items, companies, products } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };

(async () => {
    const ventasCreadas = [];
    let COMPANY = null, modoOriginal = null;
    try {
        // Compañía con más productos activos y con precio.
        const [comp] = await q(`
            SELECT c.id, c.name, c.sales_inventory_mode modo, count(p.id)::int productos
              FROM companies c JOIN products p ON p.company_id=c.id AND p.is_active AND p.sale_price>0
             GROUP BY c.id ORDER BY 4 DESC LIMIT 1`);
        COMPANY = comp.id; modoOriginal = comp.modo;
        const [{ id: ownerId }] = await q(`SELECT user_id id FROM user_companies WHERE company_id=:c AND user_type='owner' LIMIT 1`, { c: COMPANY });
        const [tienda] = await q(`SELECT id, name FROM stores WHERE company_id=:c LIMIT 1`, { c: COMPANY });
        const [pago] = await q(`SELECT id, name FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: COMPANY });
        const [prod] = await q(`SELECT id, name, sale_price::float8 precio FROM products WHERE company_id=:c AND is_active AND sale_price>0 ORDER BY id LIMIT 1`, { c: COMPANY });

        console.log(`\nCompañía "${comp.name}" · ${comp.productos} productos vendibles · tienda "${tienda.name}" · producto "${prod.name}" ($${prod.precio})\n`);

        const user = (modo) => ({ id: ownerId, companyId: COMPANY, userType: 'owner', permissions: [], companySalesInventoryMode: modo });
        const setModo = (m) => companies.update({ sales_inventory_mode: m }, { where: { id: COMPANY } });

        // ── 1. Catálogo en modo SIN INVENTARIO ────────────────────────────────────
        console.log('1) Catálogo del POS · modo sin_inventario');
        await setModo('sin_inventario');
        let r = res(); await ctrl.getPosCatalog({ user: user('sin_inventario') }, r);
        const cat = r._p;
        ok(r._c === 200 && cat.mode === 'sin_inventario', `responde ${r._c}, modo "${cat.mode}"`);
        ok(cat.location === null && cat.bloqueo === null, 'sin bodega y sin bloqueo (se puede vender)');
        ok(cat.items.length === comp.productos, `${cat.items.length} productos = los activos con precio del catálogo`);
        ok(cat.items.every((i) => i.disponible === null), 'todos con disponible = null (sin tope de cantidad)');
        ok(cat.items.every((i) => i.sale_price > 0 && i.name), 'todos traen nombre y precio');
        const inactivos = await q(`SELECT count(*)::int n FROM products WHERE company_id=:c AND (NOT is_active OR sale_price<=0)`, { c: COMPANY });
        ok(!cat.items.some((i) => i.disponible !== null), `no se colaron los ${inactivos[0].n} productos inactivos o sin precio`);

        // ── 2. Vender sin inventario ─────────────────────────────────────────────
        console.log('\n2) Registrar una venta sin inventario');
        const saldosAntes = await q(`SELECT COALESCE(sum(balance),0)::float8 s FROM product_stock_balances WHERE company_id=:c`, { c: COMPANY });
        const movsAntes = await q(`SELECT count(*)::int n FROM product_stock_movements WHERE company_id=:c`, { c: COMPANY });

        r = res();
        await ctrl.createSale({
            user: user('sin_inventario'),
            body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: prod.id, quantity: 3 }] },
        }, r);
        ok(r._c === 201, `venta creada → ${r._c} · total ${r._p.data?.total_amount}`);
        if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
        ok(r._p.data?.total_amount === prod.precio * 3, `total calculado en el servidor: ${prod.precio} × 3 = ${r._p.data?.total_amount}`);
        ok(r._p.data?.location_id === null, 'la venta NO quedó ligada a ninguna bodega (location_id null)');

        const [venta] = await q(`SELECT location_id, total_amount::float8 total, status FROM sales WHERE id=:id`, { id: ventasCreadas[0] });
        ok(venta.location_id === null && venta.status === 'completed', 'en BD: location_id NULL y status completed');
        const items = await q(`SELECT product_name, quantity::float8 q, unit_price::float8 p, total_price::float8 t FROM sale_items WHERE sale_id=:id`, { id: ventasCreadas[0] });
        ok(items.length === 1 && items[0].q === 3, `el detalle se guardó igual (${items.length} ítem, cantidad ${items[0]?.q})`);
        ok(items[0].t === prod.precio * 3, 'con sus snapshots de precio y total (los reportes y el costo siguen funcionando)');

        const saldosDespues = await q(`SELECT COALESCE(sum(balance),0)::float8 s FROM product_stock_balances WHERE company_id=:c`, { c: COMPANY });
        const movsDespues = await q(`SELECT count(*)::int n FROM product_stock_movements WHERE company_id=:c`, { c: COMPANY });
        ok(saldosAntes[0].s === saldosDespues[0].s, `el inventario NO se movió (${saldosAntes[0].s} unidades antes y después)`);
        ok(movsAntes[0].n === movsDespues[0].n, `no se creó ningún movimiento de stock (${movsAntes[0].n} antes y después)`);

        // ── 3. Producto inactivo: el catálogo es el guardián ─────────────────────
        console.log('\n3) Guardas del modo sin inventario');
        const [inactivo] = await q(`SELECT id, name FROM products WHERE company_id=:c AND NOT is_active LIMIT 1`, { c: COMPANY });
        if (inactivo) {
            r = res();
            await ctrl.createSale({ user: user('sin_inventario'), body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: inactivo.id, quantity: 1 }] } }, r);
            if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
            ok(r._c === 400 && /ya no está disponible/.test(r._p.message), `vender un producto inactivo → ${r._c} · "${r._p.message}"`);
        } else {
            // No hay inactivos: se desactiva uno temporalmente para probar la guarda.
            await products.update({ is_active: false }, { where: { id: prod.id } });
            r = res();
            await ctrl.createSale({ user: user('sin_inventario'), body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: prod.id, quantity: 1 }] } }, r);
            if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
            ok(r._c === 400 && /ya no está disponible/.test(r._p.message), `vender un producto inactivo → ${r._c} · "${r._p.message}"`);
            await products.update({ is_active: true }, { where: { id: prod.id } });
        }

        r = res();
        await ctrl.createSale({ user: user('sin_inventario'), body: { store_id: tienda.id, payment_method_id: pago.id, items: [] } }, r);
        ok(r._c === 400, `venta sin ítems → ${r._c}`);
        r = res();
        await ctrl.createSale({ user: user('sin_inventario'), body: { store_id: 999999, payment_method_id: pago.id, items: [{ product_id: prod.id, quantity: 1 }] } }, r);
        ok(r._c === 404, `tienda de otra compañía / inexistente → ${r._c}`);

        // ── 4. Modo en construcción: avisa, no adivina ───────────────────────────
        console.log('\n4) Modo "descontar de bodega principal" (aún no implementado)');
        r = res(); await ctrl.getPosCatalog({ user: user('descuenta_central') }, r);
        ok(r._c === 200 && r._p.bloqueo?.code === 'modo_en_construccion', `catálogo → bloqueo "${r._p.bloqueo?.code}"`);
        ok(r._p.items.length === 0, 'no ofrece productos (no se puede vender en ese modo todavía)');
        r = res();
        await ctrl.createSale({ user: user('descuenta_central'), body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: prod.id, quantity: 1 }] } }, r);
        if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
        ok(r._c === 400 && /construcción/.test(r._p.message), `vender → ${r._c} (no cae en otro modo por error)`);

        // ── 5. El modo de bodegas sigue igual que antes ──────────────────────────
        console.log('\n5) Modo "descontar de bodegas" (no se tocó)');
        r = res(); await ctrl.getPosCatalog({ user: user('descuenta_bodegas') }, r);
        ok(r._c === 200 && r._p.bloqueo?.code === 'sin_bodega', `usuario sin bodega → bloqueo "${r._p.bloqueo?.code}"`);
        r = res();
        await ctrl.createSale({ user: user('descuenta_bodegas'), body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: prod.id, quantity: 1 }] } }, r);
        if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
        ok(r._c === 400 && /bodega asignada/.test(r._p.message), `vender sin bodega → ${r._c} · "${r._p.message}"`);

        // Con bodega asignada: la lista sale del stock de esa bodega.
        const [bodega] = await q(`SELECT id, name FROM inventory_locations WHERE company_id=:c AND deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`, { c: COMPANY });
        const vendedorConBodega = { ...user('descuenta_bodegas'), id: ownerId };
        await sequelize.query(`UPDATE inventory_locations SET user_id=:u WHERE id=:l`, { replacements: { u: ownerId, l: bodega.id } });
        try {
            r = res(); await ctrl.getPosCatalog({ user: vendedorConBodega }, r);
            const conStock = await q(`SELECT count(*)::int n FROM product_stock_balances WHERE location_id=:l`, { l: bodega.id });
            ok(r._c === 200 && r._p.bloqueo === null && r._p.location?.id === bodega.id, `con bodega "${r._p.location?.name}" → sin bloqueo`);
            ok(r._p.items.length === conStock[0].n, `${r._p.items.length} productos = las filas de saldo de esa bodega`);
            ok(r._p.items.every((i) => typeof i.disponible === 'number'), 'todos con disponible numérico (el POS sí acota la cantidad)');
        } finally {
            await sequelize.query(`UPDATE inventory_locations SET user_id=NULL WHERE id=:l`, { replacements: { l: bodega.id } });
        }
    } finally {
        for (const id of ventasCreadas) {
            await sale_items.destroy({ where: { sale_id: id }, force: true });
            await sales.destroy({ where: { id }, force: true, userId: 'limpieza' });
        }
        if (COMPANY && modoOriginal) await companies.update({ sales_inventory_mode: modoOriginal }, { where: { id: COMPANY } });
        console.log(`\n🧹 Limpieza: ${ventasCreadas.length} venta(s) de prueba borradas, modo restaurado a "${modoOriginal}".`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
