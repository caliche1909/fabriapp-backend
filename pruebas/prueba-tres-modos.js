require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// Verificación de los TRES modos de venta + la regla "los agotados se muestran en 0".
// Restaura el estado exacto al terminar (saldos, movimientos, responsable, modo, productos).
const { sequelize, sales, sale_items, companies, products, inventory_locations, product_stock_movements } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };

(async () => {
    const ventasCreadas = [];
    let COMPANY = null, modoOriginal = null, central = null, movil = null;
    let respCentral = null, respMovil = null, saldoOriginal = null, prod = null, prodExtraId = null;
    try {
        const [comp] = await q(`
            SELECT c.id, c.name, c.sales_inventory_mode modo
              FROM companies c JOIN products p ON p.company_id=c.id AND p.is_active AND p.sale_price>0
             GROUP BY c.id ORDER BY count(p.id) DESC LIMIT 1`);
        COMPANY = comp.id; modoOriginal = comp.modo;
        const [{ id: ownerId }] = await q(`SELECT user_id id FROM user_companies WHERE company_id=:c AND user_type='owner' LIMIT 1`, { c: COMPANY });
        const [tienda] = await q(`SELECT id FROM stores WHERE company_id=:c LIMIT 1`, { c: COMPANY });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: COMPANY });
        const [fila] = await q(`
            SELECT p.id, p.name, p.sale_price::float8 precio, b.balance::float8 saldo, b.location_id
              FROM product_stock_balances b JOIN products p ON p.id=b.product_id
             WHERE b.company_id=:c AND b.balance>0 AND p.is_active AND p.sale_price>0
             ORDER BY b.balance DESC LIMIT 1`, { c: COMPANY });
        prod = fila; saldoOriginal = fila.saldo;
        [central] = await q(`SELECT id, name, user_id FROM inventory_locations WHERE company_id=:c AND is_default AND deleted_at IS NULL`, { c: COMPANY });
        [movil] = await q(`SELECT id, name, user_id FROM inventory_locations WHERE company_id=:c AND NOT is_default AND deleted_at IS NULL LIMIT 1`, { c: COMPANY });
        respCentral = central.user_id; respMovil = movil ? movil.user_id : null;
        ok(central.id === fila.location_id, `el producto con saldo está en la CENTRAL ("${central.name}")`);

        // Un segundo producto SIN existencias, para probar que aparece en 0 y no se oculta.
        const [extra] = await q(`
            INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
            VALUES (:c, 'ZZZ producto de prueba sin stock', 'TEST-SIN-STOCK', 5000, 1000, 0, true, now(), now())
            RETURNING id`, { c: COMPANY });
        prodExtraId = extra.id;

        const user = (modo) => ({ id: ownerId, companyId: COMPANY, userType: 'owner', permissions: [], companySalesInventoryMode: modo });
        const venta = (modo, cantidad, pid = prod.id) => {
            const r = res();
            return ctrl.createSale({ user: user(modo), body: { store_id: tienda.id, payment_method_id: pago.id, items: [{ product_id: pid, quantity: cantidad }] } }, r)
                .then(() => { if (r._p?.data?.id) ventasCreadas.push(r._p.data.id); return r; });
        };
        const catalogo = async (modo) => { const r = res(); await ctrl.getPosCatalog({ user: user(modo) }, r); return r._p; };
        const saldo = async (loc) => {
            const f = await q(`SELECT balance::float8 b FROM product_stock_balances WHERE product_id=:p AND location_id=:l`, { p: prod.id, l: loc });
            return f.length ? f[0].b : 0;
        };
        const movs = async () => (await q(`SELECT count(*)::int n FROM product_stock_movements WHERE company_id=:c`, { c: COMPANY }))[0].n;

        console.log(`\nCompañía "${comp.name}" · producto "${prod.name}" ($${prod.precio}) con ${saldoOriginal} u. en la central\n`);

        // ══ MODO 1 ══════════════════════════════════════════════════════════════
        console.log('MODO 1 · Vender sin inventarios');
        await companies.update({ sales_inventory_mode: 'sin_inventario' }, { where: { id: COMPANY } });
        let cat = await catalogo('sin_inventario');
        ok(cat.bloqueo === null && cat.location === null, 'se puede vender, sin bodega');
        ok(cat.items.every((i) => i.disponible === null), `${cat.items.length} productos, todos sin tope de cantidad`);
        ok(cat.items.some((i) => i.product_id === prodExtraId), 'el producto sin existencias TAMBIÉN aparece (aquí no hay stock que mirar)');
        const m0 = await movs(), s0 = await saldo(central.id);
        let r = await venta('sin_inventario', 4);
        ok(r._c === 201 && r._p.data.location_id === null, `venta 201 sin bodega · total ${r._p.data?.total_amount}`);
        ok(await saldo(central.id) === s0 && await movs() === m0, `el inventario no se tocó (${s0} u., sin movimientos nuevos)`);

        // ══ MODO 2 ══════════════════════════════════════════════════════════════
        console.log('\nMODO 2 · Vender y descontar de la bodega principal');
        await companies.update({ sales_inventory_mode: 'descuenta_central' }, { where: { id: COMPANY } });
        cat = await catalogo('descuenta_central');
        ok(cat.bloqueo === null && cat.location?.id === central.id, `sin bloqueo · vendiendo desde "${cat.location?.name}"`);
        const conStock = cat.items.find((i) => i.product_id === prod.id);
        const sinStock = cat.items.find((i) => i.product_id === prodExtraId);
        ok(conStock?.disponible === s0, `"${prod.name}" muestra su existencia real (${conStock?.disponible})`);
        ok(sinStock && sinStock.disponible === 0, 'el producto agotado APARECE con existencia 0 (no se oculta)');

        const m1 = await movs();
        r = await venta('descuenta_central', 5);
        ok(r._c === 201 && r._p.data.location_id === central.id, `venta 201 ligada a la bodega principal (${r._p.data?.location_id})`);
        ok(await saldo(central.id) === s0 - 5, `el saldo de la central bajó de ${s0} a ${await saldo(central.id)}`);
        ok(await movs() === m1 + 1, 'se creó exactamente 1 movimiento');
        let [mov] = await q(`SELECT movement_type, quantity_change::float8 q, location_id, reference_type FROM product_stock_movements WHERE company_id=:c ORDER BY id DESC LIMIT 1`, { c: COMPANY });
        ok(mov.movement_type === 'SALIDA' && mov.q === -5 && mov.location_id === central.id && mov.reference_type === 'sale',
            'SALIDA de -5 en la central, enlazada a la venta');

        r = await venta('descuenta_central', 1, prodExtraId);
        ok(r._c === 409 && /insuficiente/i.test(r._p.message), `vender lo agotado → ${r._c} · "${r._p.message}"`);
        r = await venta('descuenta_central', 999999);
        ok(r._c === 409, 'vender más de lo que hay → 409');
        ok(await saldo(central.id) === s0 - 5, 'los intentos fallidos no movieron el saldo');
        ok(ownerId !== respCentral, 'y todo esto SIN ser responsable de ninguna bodega (es el sentido del modo)');

        // ══ MODO 3 ══════════════════════════════════════════════════════════════
        console.log('\nMODO 3 · Vender y descontar de bodegas');
        await companies.update({ sales_inventory_mode: 'descuenta_bodegas' }, { where: { id: COMPANY } });
        r = await venta('descuenta_bodegas', 1);
        ok(r._c === 400 && /bodega asignada/.test(r._p.message), 'sin bodega asignada NO se puede vender');

        // (a) Una bodega MÓVIL recién creada: no ha recibido nada → no muestra nada.
        const bodegaTmp = await inventory_locations.create({
            company_id: COMPANY, name: 'ZZZ Camión de prueba', type: 'movil',
            status: 'abierta', is_default: false, is_active: true, user_id: ownerId,
        });
        cat = await catalogo('descuenta_bodegas');
        ok(cat.location?.id === bodegaTmp.id && cat.items.length === 0,
            `bodega móvil sin traspasos → lista VACÍA (no ve el catálogo de la compañía)`);
        await inventory_locations.destroy({ where: { id: bodegaTmp.id }, force: true });

        // (b) La CENTRAL como bodega del vendedor: ahí sí hay existencias que vender.
        //     Ojo: la central tiene fila de saldo de TODO producto desde que se crea, porque el
        //     trigger `tr_create_product_central_balance` se la siembra en 0. Por eso lista el
        //     catálogo completo aunque el origen sean los saldos.
        await exec(`UPDATE inventory_locations SET user_id=:u WHERE id=:l`, { u: ownerId, l: central.id });
        cat = await catalogo('descuenta_bodegas');
        ok(cat.bloqueo === null && cat.location?.id === central.id, `catálogo desde "${cat.location?.name}"`);
        ok(cat.items.find((i) => i.product_id === prod.id)?.disponible > 0,
            'el producto con existencias aparece con su saldo real');
        ok(cat.items.find((i) => i.product_id === prodExtraId)?.disponible === 0,
            'y el agotado sigue visible en 0 (su fila existe desde que se creó el producto)');
        const s1 = await saldo(central.id), m2 = await movs();
        r = await venta('descuenta_bodegas', 2);
        ok(r._c === 201 && await saldo(central.id) === s1 - 2, `venta 201 · saldo de ${s1} a ${await saldo(central.id)}`);
        ok(await movs() === m2 + 1, 'se creó exactamente 1 movimiento');

        // ══ Bodega no operativa ═════════════════════════════════════════════════
        console.log('\nGuardas de bodega');
        if (movil) {
            await exec(`UPDATE inventory_locations SET user_id=NULL WHERE id=:l`, { l: central.id });
            await exec(`UPDATE inventory_locations SET user_id=:u, status='cerrada' WHERE id=:l`, { u: ownerId, l: movil.id });
            cat = await catalogo('descuenta_bodegas');
            ok(cat.bloqueo?.code === 'bodega_no_operativa', `bodega cerrada → bloqueo "${cat.bloqueo?.code}"`);
            r = await venta('descuenta_bodegas', 1);
            ok(r._c === 400 && /cerrada/.test(r._p.message), `y la venta se rechaza → ${r._c}`);
            await exec(`UPDATE inventory_locations SET user_id=NULL, status='abierta' WHERE id=:l`, { l: movil.id });
        }
        await exec(`UPDATE inventory_locations SET status='cerrada' WHERE id=:l`, { l: central.id });
        cat = await catalogo('descuenta_central');
        ok(cat.bloqueo?.code === 'bodega_no_operativa', `central cerrada → bloqueo "${cat.bloqueo?.code}" (modo 2)`);
        await exec(`UPDATE inventory_locations SET status='abierta' WHERE id=:l`, { l: central.id });
    } finally {
        for (const id of ventasCreadas) {
            await product_stock_movements.destroy({ where: { reference_type: 'sale', reference_id: id } });
            await sale_items.destroy({ where: { sale_id: id }, force: true });
            await sales.destroy({ where: { id }, force: true, userId: 'limpieza' });
        }
        if (prod && central && saldoOriginal !== null) {
            await exec(`UPDATE product_stock_balances SET balance=:b WHERE product_id=:p AND location_id=:l`, { b: saldoOriginal, p: prod.id, l: central.id });
        }
        if (prodExtraId) {
            await exec(`DELETE FROM product_stock_balances WHERE product_id=:p`, { p: prodExtraId });
            await products.destroy({ where: { id: prodExtraId }, force: true });
        }
        if (central) await exec(`UPDATE inventory_locations SET user_id=:u, status='abierta' WHERE id=:l`, { u: respCentral, l: central.id });
        if (movil) await exec(`UPDATE inventory_locations SET user_id=:u, status='abierta' WHERE id=:l`, { u: respMovil, l: movil.id });
        if (COMPANY && modoOriginal) await companies.update({ sales_inventory_mode: modoOriginal }, { where: { id: COMPANY } });

        const [chk] = await q(`SELECT balance::float8 b FROM product_stock_balances WHERE product_id=:p AND location_id=:l`, { p: prod.id, l: central.id });
        const sobras = await q(`SELECT count(*)::int n FROM products WHERE sku='TEST-SIN-STOCK'`);
        console.log(`\n🧹 Limpieza: ${ventasCreadas.length} ventas borradas · saldo ${chk.b} (original ${saldoOriginal}) · producto de prueba restante: ${sobras[0].n} · modo "${modoOriginal}"`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
