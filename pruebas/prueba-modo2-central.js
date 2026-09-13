require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// MODO 2 (descontar de la bodega principal) bajo condiciones exigentes:
// varios ítems, producto repetido, decimales, dos vendedores distintos, CONCURRENCIA y
// cuadre del saldo contra el libro de movimientos. Restaura todo al terminar.
const { sequelize, sales, sale_items, companies, products, product_stock_movements } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };

(async () => {
    const ventasCreadas = [];
    const prodsCreados = [];
    let COMPANY = null, modoOriginal = null, central = null;
    try {
        const [comp] = await q(`SELECT id, name, sales_inventory_mode modo FROM companies WHERE EXISTS (SELECT 1 FROM stores s WHERE s.company_id=companies.id) AND EXISTS (SELECT 1 FROM inventory_locations il WHERE il.company_id=companies.id AND il.is_default) ORDER BY name LIMIT 1`);
        COMPANY = comp.id; modoOriginal = comp.modo;
        [central] = await q(`SELECT id, name FROM inventory_locations WHERE company_id=:c AND is_default AND deleted_at IS NULL`, { c: COMPANY });
        const usuarios = await q(`SELECT user_id id FROM user_companies WHERE company_id=:c AND status='active' LIMIT 2`, { c: COMPANY });
        const [tienda] = await q(`SELECT id, name FROM stores WHERE company_id=:c LIMIT 1`, { c: COMPANY });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: COMPANY });
        await companies.update({ sales_inventory_mode: 'descuenta_central' }, { where: { id: COMPANY } });

        // Dos productos de prueba, surtidos en la central con una ENTRADA real (como lo haría la app).
        for (const [n, precio, costo, cant] of [['ZZZ Producto A', 1000, 400, 100], ['ZZZ Producto B', 2500, 900, 20]]) {
            const [p] = await q(`
                INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
                VALUES (:c, :n, :sku, :precio, :costo, 0, true, now(), now()) RETURNING id`,
                { c: COMPANY, n, sku: `TEST-${n.slice(4).replace(/\s/g, '')}`, precio, costo });
            await exec(`
                INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                VALUES (:c, :p, :l, :q, 'ENTRADA', 'manual', 'carga de prueba', now())`,
                { c: COMPANY, p: p.id, l: central.id, q: cant });
            prodsCreados.push({ id: p.id, name: n, precio, costo, cant });
        }
        const [A, B] = prodsCreados;

        const user = (id) => ({ id, companyId: COMPANY, userType: 'owner', permissions: [], companySalesInventoryMode: 'descuenta_central' });
        const venta = async (uid, items) => {
            const r = res();
            await ctrl.createSale({ user: user(uid), body: { store_id: tienda.id, payment_method_id: pago.id, items } }, r);
            if (r._p?.data?.id) ventasCreadas.push(r._p.data.id);
            return r;
        };
        const saldo = async (pid) => {
            const f = await q(`SELECT balance::float8 b FROM product_stock_balances WHERE product_id=:p AND location_id=:l`, { p: pid, l: central.id });
            return f.length ? f[0].b : 0;
        };

        console.log(`\nCompañía "${comp.name}" · bodega principal "${central.name}" · A=${A.cant} u. · B=${B.cant} u.\n`);
        ok(await saldo(A.id) === 100 && await saldo(B.id) === 20, 'los productos quedaron surtidos en la bodega principal');

        // ── 1. Venta con VARIOS ítems: descuenta cada uno ────────────────────────
        console.log('1) Venta con varios productos');
        let r = await venta(usuarios[0].id, [{ product_id: A.id, quantity: 10 }, { product_id: B.id, quantity: 3 }]);
        ok(r._c === 201 && r._p.data.location_id === central.id, `201 · venta ligada a la bodega principal (${r._p.data?.location_id})`);
        ok(await saldo(A.id) === 90 && await saldo(B.id) === 17, `A: 100→${await saldo(A.id)} · B: 20→${await saldo(B.id)}`);
        const movsVenta = await q(`SELECT product_id, quantity_change::float8 q, location_id, movement_type FROM product_stock_movements WHERE reference_type='sale' AND reference_id=:id ORDER BY product_id`, { id: ventasCreadas.at(-1) });
        ok(movsVenta.length === 2 && movsVenta.every((m) => m.movement_type === 'SALIDA' && m.location_id === central.id),
            'se creó 1 SALIDA por producto, ambas en la bodega principal');

        // ── 2. Producto REPETIDO en la misma venta: se agrega, no se duplica ─────
        console.log('\n2) El mismo producto repetido en la venta');
        r = await venta(usuarios[0].id, [{ product_id: A.id, quantity: 2 }, { product_id: A.id, quantity: 3 }]);
        ok(r._c === 201 && r._p.data.item_count === 1, `201 · quedó 1 sola línea (2+3 agregados)`);
        ok(await saldo(A.id) === 85, `descontó 5 en total: 90→${await saldo(A.id)}`);
        const [movRep] = await q(`SELECT count(*)::int n FROM product_stock_movements WHERE reference_type='sale' AND reference_id=:id`, { id: ventasCreadas.at(-1) });
        ok(movRep.n === 1, 'y creó un solo movimiento (no dos por el mismo producto)');

        // ── 3. Decimales (el stock es NUMERIC(14,3)) ─────────────────────────────
        console.log('\n3) Cantidades con decimales');
        r = await venta(usuarios[0].id, [{ product_id: B.id, quantity: 1.5 }]);
        ok(r._c === 201 && await saldo(B.id) === 15.5, `vendió 1.5 · B: 17→${await saldo(B.id)}`);

        // ── 4. Otro vendedor descuenta de la MISMA bodega ────────────────────────
        console.log('\n4) Otro vendedor, la misma bodega principal');
        const otro = usuarios[1] ? usuarios[1].id : usuarios[0].id;
        r = await venta(otro, [{ product_id: A.id, quantity: 5 }]);
        ok(r._c === 201 && await saldo(A.id) === 80, `${usuarios[1] ? 'segundo usuario' : 'mismo usuario'} descontó de la central: 85→${await saldo(A.id)}`);
        const [resp] = await q(`SELECT count(*)::int n FROM inventory_locations WHERE company_id=:c AND user_id IS NOT NULL AND deleted_at IS NULL`, { c: COMPANY });
        ok(resp.n === 0, 'y ninguna bodega tiene responsable asignado (no hace falta en este modo)');

        // ── 5. CONCURRENCIA: dos ventas a la vez por más de lo que hay ───────────
        console.log('\n5) Dos ventas simultáneas compitiendo por el mismo saldo');
        const antesB = await saldo(B.id); // 15.5
        const [r1, r2] = await Promise.all([
            venta(usuarios[0].id, [{ product_id: B.id, quantity: 10 }]),
            venta(otro, [{ product_id: B.id, quantity: 10 }]),
        ]);
        const exitos = [r1, r2].filter((x) => x._c === 201).length;
        const rechazos = [r1, r2].filter((x) => x._c === 409).length;
        ok(exitos === 1 && rechazos === 1, `de 2 ventas de 10 u. con ${antesB} disponibles: ${exitos} pasó y ${rechazos} fue rechazada con 409`);
        const finalB = await saldo(B.id);
        ok(finalB === antesB - 10 && finalB >= 0, `el saldo quedó en ${finalB} (nunca negativo)`);

        // ── 6. Producto sin existencias en la central ────────────────────────────
        console.log('\n6) Producto agotado');
        await exec(`INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, created_at)
                    VALUES (:c, :p, :l, :q, 'AJUSTE', 'manual', now())`, { c: COMPANY, p: B.id, l: central.id, q: -finalB });
        ok(await saldo(B.id) === 0, 'se dejó B en 0 con un ajuste');
        const cat = await (async () => { const rr = res(); await ctrl.getPosCatalog({ user: user(usuarios[0].id) }, rr); return rr._p; })();
        ok(cat.items.find((i) => i.product_id === B.id)?.disponible === 0, 'el POS lo muestra en 0 (visible, no oculto)');
        r = await venta(usuarios[0].id, [{ product_id: B.id, quantity: 1 }]);
        ok(r._c === 409 && /insuficiente/i.test(r._p.message), `vender lo agotado → ${r._c} · "${r._p.message}"`);

        // ── 7. Cuadre: saldo == suma del libro de movimientos ────────────────────
        console.log('\n7) Cuadre contable de la bodega principal');
        const cuadre = await q(`
            SELECT p.name,
                   COALESCE(b.balance,0)::float8 AS saldo,
                   COALESCE(sum(m.quantity_change),0)::float8 AS libro
              FROM products p
              LEFT JOIN product_stock_balances b ON b.product_id=p.id AND b.location_id=:l
              LEFT JOIN product_stock_movements m ON m.product_id=p.id AND m.location_id=:l
             WHERE p.id IN (:ids)
             GROUP BY p.name, b.balance ORDER BY 1`, { l: central.id, ids: prodsCreados.map((p) => p.id) });
        console.table(cuadre);
        ok(cuadre.every((f) => f.saldo === f.libro), 'el saldo de cada producto = la suma de sus movimientos (sin descuadres)');
        const [neg] = await q(`SELECT count(*)::int n FROM product_stock_balances WHERE balance < 0`);
        ok(neg.n === 0, 'ningún saldo negativo en toda la base');
    } finally {
        for (const id of ventasCreadas) {
            await product_stock_movements.destroy({ where: { reference_type: 'sale', reference_id: id } });
            await sale_items.destroy({ where: { sale_id: id }, force: true });
            await sales.destroy({ where: { id }, force: true, userId: 'limpieza' });
        }
        for (const p of prodsCreados) {
            await exec(`DELETE FROM product_stock_movements WHERE product_id=:p`, { p: p.id });
            await exec(`DELETE FROM product_stock_balances WHERE product_id=:p`, { p: p.id });
            await products.destroy({ where: { id: p.id }, force: true });
        }
        if (COMPANY && modoOriginal) await companies.update({ sales_inventory_mode: modoOriginal }, { where: { id: COMPANY } });
        const [sobras] = await q(`SELECT (SELECT count(*)::int FROM products WHERE sku LIKE 'TEST-%') p, (SELECT count(*)::int FROM product_stock_movements WHERE description='carga de prueba') m`);
        console.log(`\n🧹 Limpieza: ${ventasCreadas.length} ventas y ${prodsCreados.length} productos borrados · sobras: ${sobras.p} productos, ${sobras.m} movimientos · modo "${modoOriginal}"`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
