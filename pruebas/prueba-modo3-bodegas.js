require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// MODO 3 (cada vendedor vende de SU bodega): ciclo real completo.
// Surtir la central → traspasar a la bodega del vendedor → recibir → vender desde ella.
// Verifica aislamiento entre vendedores, atomicidad, concurrencia y cuadre. Borra todo al final.
const { sequelize, sales, sale_items, companies, products, inventory_locations,
    stock_transfers, stock_transfer_items, product_stock_movements } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ventasCtrl = require(RAIZ_SERVER + '/src/controllers/sales_controller.js');
const traspasosCtrl = require(RAIZ_SERVER + '/src/controllers/stock_transfers_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };

(async () => {
    const ventasCreadas = [], prodsCreados = [], bodegasCreadas = [], traspasosCreados = [];
    let COMPANY = null, modoOriginal = null, central = null;
    try {
        const [comp] = await q(`
            SELECT id, name, sales_inventory_mode modo FROM companies
             WHERE EXISTS (SELECT 1 FROM stores s WHERE s.company_id=companies.id)
               AND EXISTS (SELECT 1 FROM inventory_locations il WHERE il.company_id=companies.id AND il.is_default)
               AND (SELECT count(*) FROM user_companies uc WHERE uc.company_id=companies.id AND uc.status='active') >= 2
             ORDER BY name LIMIT 1`);
        COMPANY = comp.id; modoOriginal = comp.modo;
        [central] = await q(`SELECT id, name FROM inventory_locations WHERE company_id=:c AND is_default AND deleted_at IS NULL`, { c: COMPANY });
        const users = await q(`
            SELECT uc.user_id id, u.first_name nombre FROM user_companies uc JOIN users u ON u.id=uc.user_id
             WHERE uc.company_id=:c AND uc.status='active'
               AND NOT EXISTS (SELECT 1 FROM inventory_locations il WHERE il.company_id=uc.company_id AND il.user_id=uc.user_id AND il.deleted_at IS NULL)
             ORDER BY u.first_name LIMIT 3`, { c: COMPANY });
        const [tienda] = await q(`SELECT id FROM stores WHERE company_id=:c LIMIT 1`, { c: COMPANY });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: COMPANY });
        const [vendA, vendB, jefe] = users;
        await companies.update({ sales_inventory_mode: 'descuenta_bodegas' }, { where: { id: COMPANY } });

        // Productos surtidos en la CENTRAL.
        for (const [n, precio, costo, cant] of [['ZZZ Producto A', 1000, 400, 200], ['ZZZ Producto B', 2500, 900, 60]]) {
            const [p] = await q(`
                INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
                VALUES (:c, :n, :sku, :precio, :costo, 0, true, now(), now()) RETURNING id`,
                { c: COMPANY, n, sku: `TEST-${n.slice(4).replace(/\s/g, '')}`, precio, costo });
            await exec(`INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                        VALUES (:c, :p, :l, :q, 'ENTRADA', 'manual', 'carga de prueba', now())`,
                { c: COMPANY, p: p.id, l: central.id, q: cant });
            prodsCreados.push({ id: p.id, name: n, precio, costo });
        }
        const [A, B] = prodsCreados;

        // Bodegas móviles: una por vendedor.
        for (const [v, nombre] of [[vendA, 'ZZZ Camión A'], [vendB, 'ZZZ Camión B']]) {
            const b = await inventory_locations.create({
                company_id: COMPANY, name: nombre, type: 'movil', status: 'abierta',
                is_default: false, is_active: true, user_id: v.id,
            });
            bodegasCreadas.push({ id: b.id, name: nombre, user: v });
        }
        const [camionA, camionB] = bodegasCreadas;

        const user = (id) => ({ id, companyId: COMPANY, userType: 'owner', permissions: [], companySalesInventoryMode: 'descuenta_bodegas' });
        const catalogo = async (uid) => { const r = res(); await ventasCtrl.getPosCatalog({ user: user(uid) }, r); return r._p; };
        const venta = async (uid, items) => {
            const r = res();
            await ventasCtrl.createSale({ user: user(uid), body: { store_id: tienda.id, payment_method_id: pago.id, items } }, r);
            if (r._p?.data?.id) ventasCreadas.push(r._p.data.id);
            return r;
        };
        const saldo = async (pid, loc) => {
            const f = await q(`SELECT balance::float8 b FROM product_stock_balances WHERE product_id=:p AND location_id=:l`, { p: pid, l: loc });
            return f.length ? f[0].b : 0;
        };

        console.log(`\nCompañía "${comp.name}" · central "${central.name}" · vendedores: ${vendA.nombre} (${camionA.name}) y ${vendB.nombre} (${camionB.name})\n`);

        // ── 1. Sin bodega no se vende ────────────────────────────────────────────
        console.log('1) Requisito: tener bodega');
        if (jefe) {
            const cat = await catalogo(jefe.id);
            ok(cat.bloqueo?.code === 'sin_bodega' && cat.items.length === 0, `${jefe.nombre} no tiene bodega → bloqueo "${cat.bloqueo?.code}", 0 productos`);
            const r = await venta(jefe.id, [{ product_id: A.id, quantity: 1 }]);
            ok(r._c === 400 && /bodega asignada/.test(r._p.message), `y su venta se rechaza → ${r._c}`);
        }

        // ── 2. Bodega vacía: no muestra NADA (aún no ha recibido nada) ───────────
        console.log('\n2) Con bodega pero SIN haber recibido nada');
        let cat = await catalogo(vendA.id);
        ok(cat.bloqueo === null && cat.location?.id === camionA.id, `catálogo de ${vendA.nombre} apunta a "${cat.location?.name}"`);
        ok(cat.items.length === 0, `su lista está VACÍA (no ve el catálogo de la compañía, que tiene ${prodsCreados.length} productos)`);
        let r = await venta(vendA.id, [{ product_id: A.id, quantity: 1 }]);
        ok(r._c === 409 && /insuficiente/i.test(r._p.message), `no puede vender lo que no tiene → ${r._c}`);

        // ── 3. Traspaso real: central → camión A ─────────────────────────────────
        console.log('\n3) Surtir el camión con un traspaso real');
        const jefeUser = { id: (jefe || vendA).id, companyId: COMPANY, userType: 'owner', permissions: [] };
        r = res();
        await traspasosCtrl.createTransfer({
            user: jefeUser,
            body: { from_location_id: central.id, to_location_id: camionA.id, items: [{ product_id: A.id, quantity: 50 }, { product_id: B.id, quantity: 10 }] },
        }, r);
        ok(r._c === 201, `traspaso emitido → ${r._c} (${r._p.transfer?.status})`);
        const trId = r._p.transfer?.id; if (trId) traspasosCreados.push(trId);
        ok(await saldo(A.id, central.id) === 150, `salió de la central: 200→${await saldo(A.id, central.id)}`);
        ok(await saldo(A.id, camionA.id) === 0, 'y AÚN no entró al camión (está en tránsito)');

        const its = await q(`SELECT id, product_id, quantity::float8 q FROM stock_transfer_items WHERE transfer_id=:t ORDER BY id`, { t: trId });
        r = res();
        await traspasosCtrl.receiveTransfer({
            user: { ...jefeUser, id: vendA.id },
            params: { id: String(trId) },
            body: { items: its.map((i) => ({ item_id: i.id, received_quantity: i.q })) },
        }, r);
        ok(r._c === 200, `el vendedor recibe el traspaso → ${r._c}`);
        ok(await saldo(A.id, camionA.id) === 50 && await saldo(B.id, camionA.id) === 10, `ya tiene A=${await saldo(A.id, camionA.id)} y B=${await saldo(B.id, camionA.id)} en su camión`);

        // ── 4. Vender de SU bodega ───────────────────────────────────────────────
        console.log('\n4) Vender desde el camión');
        cat = await catalogo(vendA.id);
        ok(cat.items.find((i) => i.product_id === A.id)?.disponible === 50, 'el POS muestra la existencia real de su camión');
        const centralAntes = await saldo(A.id, central.id);
        r = await venta(vendA.id, [{ product_id: A.id, quantity: 12 }, { product_id: B.id, quantity: 2 }]);
        ok(r._c === 201 && r._p.data.location_id === camionA.id, `venta 201 ligada a SU bodega (${r._p.data?.location_id})`);
        ok(await saldo(A.id, camionA.id) === 38 && await saldo(B.id, camionA.id) === 8, `descontó de su camión: A=38, B=8`);
        ok(await saldo(A.id, central.id) === centralAntes, `y la CENTRAL no se tocó (sigue en ${centralAntes})`);
        const movs = await q(`SELECT location_id, count(*)::int n FROM product_stock_movements WHERE reference_type='sale' AND reference_id=:id GROUP BY 1`, { id: ventasCreadas.at(-1) });
        ok(movs.length === 1 && movs[0].location_id === camionA.id && movs[0].n === 2, 'los 2 movimientos salieron del camión, ninguno de la central');

        // ── 4b. Producto AGOTADO: se sigue mostrando en 0 ────────────────────────
        console.log('\n4b) Un producto de la bodega que se acaba');
        r = await venta(vendA.id, [{ product_id: B.id, quantity: 8 }]);
        ok(r._c === 201 && await saldo(B.id, camionA.id) === 0, `${vendA.nombre} vendió las 8 unidades restantes de B → saldo 0`);
        cat = await catalogo(vendA.id);
        const agotado = cat.items.find((i) => i.product_id === B.id);
        ok(agotado !== undefined && agotado.disponible === 0,
            'B SIGUE en su lista, en 0 → sabe que se le acabó y que debe pedir más para la próxima jornada');
        ok(cat.items.length === 2, `su lista sigue teniendo sus ${cat.items.length} productos (lo recibido, no el catálogo)`);

        // ── 5. Aislamiento entre vendedores ──────────────────────────────────────
        console.log('\n5) Cada vendedor ve y descuenta lo SUYO');
        const catB = await catalogo(vendB.id);
        ok(catB.location?.id === camionB.id, `${vendB.nombre} apunta a "${catB.location?.name}"`);
        ok(catB.items.length === 0, `y su lista está vacía: no ve nada del camión de ${vendA.nombre}`);
        r = await venta(vendB.id, [{ product_id: A.id, quantity: 1 }]);
        ok(r._c === 409, 'no puede vender del camión ajeno → 409');
        ok(await saldo(A.id, camionA.id) === 38, `el saldo de ${vendA.nombre} quedó intacto (38)`);

        // ── 6. Atomicidad: si un ítem falla, no se guarda NADA ───────────────────
        console.log('\n6) Venta con un producto sin stock suficiente');
        // Se repone algo de B para que la prueba mida la atomicidad y no el agotamiento.
        await exec(`INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                    VALUES (:c, :p, :l, 8, 'AJUSTE', 'manual', 'carga de prueba', now())`, { c: COMPANY, p: B.id, l: camionA.id });
        const antesA = await saldo(A.id, camionA.id), antesB = await saldo(B.id, camionA.id);
        const ventasAntes = (await q(`SELECT count(*)::int n FROM sales WHERE company_id=:c`, { c: COMPANY }))[0].n;
        r = await venta(vendA.id, [{ product_id: A.id, quantity: 5 }, { product_id: B.id, quantity: 999 }]);
        ok(r._c === 409, `la venta completa se rechaza → ${r._c}`);
        ok(await saldo(A.id, camionA.id) === antesA && await saldo(B.id, camionA.id) === antesB,
            `y NINGÚN producto se descontó (A=${antesA}, B=${antesB} intactos)`);
        const ventasDespues = (await q(`SELECT count(*)::int n FROM sales WHERE company_id=:c`, { c: COMPANY }))[0].n;
        ok(ventasAntes === ventasDespues, 'no quedó una venta a medias en la base');

        // ── 7. Concurrencia en la misma bodega ───────────────────────────────────
        console.log('\n7) Dos ventas simultáneas del mismo camión');
        const antes = await saldo(B.id, camionA.id); // 8
        const [r1, r2] = await Promise.all([
            venta(vendA.id, [{ product_id: B.id, quantity: 6 }]),
            venta(vendA.id, [{ product_id: B.id, quantity: 6 }]),
        ]);
        const exitos = [r1, r2].filter((x) => x._c === 201).length;
        ok(exitos === 1 && [r1, r2].filter((x) => x._c === 409).length === 1, `con ${antes} disponibles: 1 pasó, 1 rechazada`);
        ok(await saldo(B.id, camionA.id) === antes - 6, `saldo final ${await saldo(B.id, camionA.id)}, nunca negativo`);

        // ── 8. Cuadre de las dos bodegas ─────────────────────────────────────────
        console.log('\n8) Cuadre contable de central y camión');
        const cuadre = await q(`
            SELECT il.name AS bodega, p.name AS producto,
                   COALESCE(b.balance,0)::float8 AS saldo,
                   COALESCE((SELECT sum(m.quantity_change) FROM product_stock_movements m
                              WHERE m.product_id=p.id AND m.location_id=il.id),0)::float8 AS libro
              FROM inventory_locations il
              CROSS JOIN products p
              LEFT JOIN product_stock_balances b ON b.product_id=p.id AND b.location_id=il.id
             WHERE il.id IN (:locs) AND p.id IN (:prods)
             ORDER BY 1,2`, { locs: [central.id, camionA.id, camionB.id], prods: prodsCreados.map((p) => p.id) });
        console.table(cuadre);
        ok(cuadre.every((f) => f.saldo === f.libro), 'en TODAS las bodegas el saldo = la suma de sus movimientos');
        const [neg] = await q(`SELECT count(*)::int n FROM product_stock_balances WHERE balance < 0`);
        ok(neg.n === 0, 'ningún saldo negativo en la base');
    } finally {
        for (const id of ventasCreadas) {
            await product_stock_movements.destroy({ where: { reference_type: 'sale', reference_id: id } });
            await sale_items.destroy({ where: { sale_id: id }, force: true });
            await sales.destroy({ where: { id }, force: true, userId: 'limpieza' });
        }
        for (const t of traspasosCreados) {
            await product_stock_movements.destroy({ where: { reference_type: 'stock_transfer', reference_id: t } });
            await stock_transfer_items.destroy({ where: { transfer_id: t }, force: true });
            await stock_transfers.destroy({ where: { id: t }, force: true, userId: 'limpieza' });
        }
        for (const p of prodsCreados) {
            await exec(`DELETE FROM product_stock_movements WHERE product_id=:p`, { p: p.id });
            await exec(`DELETE FROM product_stock_balances WHERE product_id=:p`, { p: p.id });
            await products.destroy({ where: { id: p.id }, force: true });
        }
        for (const b of bodegasCreadas) await inventory_locations.destroy({ where: { id: b.id }, force: true });
        if (COMPANY && modoOriginal) await companies.update({ sales_inventory_mode: modoOriginal }, { where: { id: COMPANY } });
        const [sobras] = await q(`SELECT (SELECT count(*)::int FROM products WHERE sku LIKE 'TEST-%') p,
                                         (SELECT count(*)::int FROM inventory_locations WHERE name LIKE 'ZZZ%') b,
                                         (SELECT count(*)::int FROM product_stock_movements WHERE description='carga de prueba') m`);
        console.log(`\n🧹 Limpieza: ${ventasCreadas.length} ventas, ${traspasosCreados.length} traspasos, ${prodsCreados.length} productos, ${bodegasCreadas.length} bodegas · sobras: ${sobras.p}/${sobras.b}/${sobras.m} · modo "${modoOriginal}"`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
