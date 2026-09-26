require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * NOVEDAD DE TRASPASO — que cuadrarla MUEVA stock, y que nada se invente ni se evapore.
 *
 * 🔴 LO QUE MÁS IMPORTA DEMOSTRAR: que **no se puede crear mercancía de la nada**. El 2026-09-24,
 * en producción, el traspaso #10 salió de la Bodega Central con 15 abuelas y entró a Aeroban con
 * 16. La unidad 16 nació de la nada: `receiveTransfer` acreditaba lo declarado por el receptor sin
 * tope y nunca volvía al origen, y `resolveDiscrepancy` solo ponía una bandera. Se marcó como
 * "resuelta" a las 08:03 con los libros torcidos, y alguien la compensó a mano a las 08:56.
 *
 * Ahora cuadrar la novedad OBLIGA a que una de las dos bodegas asuma la diferencia, y el ajuste lo
 * genera el servidor, amarrado al traspaso. Con E = enviado y R = recibido, el ajuste es **E − R**
 * en los dos casos; lo único que cambia es la bodega. Esta batería ejerce las cuatro combinaciones
 * (recibir de más / de menos × vale lo enviado / vale lo recibido) y comprueba que en las cuatro
 * **la suma de los movimientos del traspaso vuelve a cero**.
 *
 * Crea sus propios productos, bodegas y traspasos, y los borra al final.
 */
const { sequelize, products, inventory_locations, stock_transfers, stock_transfer_items,
    product_stock_movements } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/stock_transfers_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };
const titulo = (t) => console.log(`\n${t}\n${'─'.repeat(Math.min(78, t.length + 2))}`);

(async () => {
    const prodsCreados = [], bodegasCreadas = [], traspasosCreados = [];
    let COMPANY = null, central = null;
    try {
        const [comp] = await q(`
            SELECT c.id FROM companies c
             WHERE EXISTS (SELECT 1 FROM inventory_locations il
                            WHERE il.company_id = c.id AND il.is_default AND il.deleted_at IS NULL)
             ORDER BY c.name LIMIT 1`);
        COMPANY = comp.id;
        [central] = await q(`SELECT id, name FROM inventory_locations
                              WHERE company_id = :c AND is_default AND deleted_at IS NULL`, { c: COMPANY });
        const [jefe] = await q(`SELECT user_id id FROM user_companies
                                 WHERE company_id = :c AND status = 'active' LIMIT 1`, { c: COMPANY });

        const destino = await inventory_locations.create({
            company_id: COMPANY, name: 'ZZZ Camion de prueba', type: 'movil',
            status: 'abierta', is_default: false, is_active: true, user_id: null,
        });
        bodegasCreadas.push(destino.id);

        const user = { id: jefe.id, companyId: COMPANY, userType: 'owner', permissions: [] };

        /** Crea un producto con `cant` unidades ya puestas en la central. */
        const producto = async (nombre, cant) => {
            const [p] = await q(`
                INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
                VALUES (:c, :n, :sku, 1000, 400, 0, true, now(), now()) RETURNING id`,
                { c: COMPANY, n: nombre, sku: `TEST-NOV-${nombre.slice(-1)}` });
            if (cant > 0) {
                await exec(`INSERT INTO product_stock_movements
                                (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                            VALUES (:c, :p, :l, :q, 'ENTRADA', 'manual', 'carga de prueba novedad', now())`,
                    { c: COMPANY, p: p.id, l: central.id, q: cant });
            }
            prodsCreados.push(p.id);
            return p.id;
        };

        const saldo = async (prod, loc) => {
            const [f] = await q(`SELECT balance::float8 b FROM product_stock_balances
                                  WHERE product_id = :p AND location_id = :l`, { p: prod, l: loc });
            return f ? f.b : 0;
        };

        /** Emite un traspaso de `enviado` y lo recibe declarando `recibido`. */
        const emitirYRecibir = async (prod, enviado, recibido) => {
            let r = res();
            await ctrl.createTransfer({
                user,
                body: { from_location_id: central.id, to_location_id: destino.id, items: [{ product_id: prod, quantity: enviado }] },
            }, r);
            if (r._c !== 201) throw new Error(`no se pudo emitir el traspaso: ${r._c} ${r._p && r._p.message}`);
            const trId = r._p.transfer.id;
            traspasosCreados.push(trId);
            const [it] = await q(`SELECT id FROM stock_transfer_items WHERE transfer_id = :t`, { t: trId });
            r = res();
            await ctrl.receiveTransfer({
                user, params: { id: String(trId) },
                body: { items: [{ item_id: it.id, received_quantity: recibido }], reception_notes: 'conteo de la prueba' },
            }, r);
            if (r._c !== 200) throw new Error(`no se pudo recibir el traspaso: ${r._c} ${r._p && r._p.message}`);
            return { trId, itemId: it.id };
        };

        /** Suma TODOS los movimientos del traspaso: las dos patas + el ajuste del cuadre. */
        const sumaDelGrupo = async (trId) => {
            const [f] = await q(`SELECT coalesce(sum(quantity_change), 0)::float8 s FROM product_stock_movements
                                  WHERE reference_type = 'stock_transfer' AND reference_id = :t`, { t: trId });
            return f.s;
        };

        const cuadrar = async (trId, itemId, veredicto, notas) => {
            const r = res();
            await ctrl.resolveDiscrepancy({
                user, params: { id: String(trId) },
                body: { verdicts: itemId ? [{ item_id: itemId, verdict: veredicto }] : undefined, resolution_notes: notas },
            }, r);
            return r;
        };

        // ── 1 ────────────────────────────────────────────────────────────────────
        titulo('1) 🔴 SIN VEREDICTO NO SE CUADRA: la diferencia no puede quedar volando');
        const A = await producto('ZZZ Novedad A', 100);
        const t1 = await emitirYRecibir(A, 15, 16);
        ok(await saldo(A, destino.id) === 16, 'el destino recibió 16 aunque salieron 15 (así nace la novedad)');
        ok(await sumaDelGrupo(t1.trId) === 1,
            `y por ahora el traspaso NO conserva: suma ${await sumaDelGrupo(t1.trId)} — una unidad inventada`);

        let r = await cuadrar(t1.trId, null, null, 'sin decir quien asume');
        ok(r._c === 400, `resolver sin veredicto se rechaza → ${r._c}`);
        ok(/tiene que asumir/i.test((r._p && r._p.message) || ''), `y lo dice en cristiano: "${r._p && r._p.message}"`);
        let [sigue] = await q(`SELECT discrepancy_resolved d FROM stock_transfers WHERE id = :t`, { t: t1.trId });
        ok(sigue.d === false, 'la novedad sigue SIN resolver: no se marcó a medias');

        r = await cuadrar(t1.trId, t1.itemId, 'QUIZAS');
        ok(r._c === 400, `un veredicto que no es ENVIADO/RECIBIDO se rechaza → ${r._c}`);

        // ── 2 ────────────────────────────────────────────────────────────────────
        titulo('2) Recibido de MÁS (15→16) · "vale lo recibido" → asume el ORIGEN');
        const centralAntes = await saldo(A, central.id);
        r = await cuadrar(t1.trId, t1.itemId, 'RECIBIDO');
        ok(r._c === 200, `se cuadra → ${r._c}`);
        ok(await saldo(A, central.id) === centralAntes - 1,
            `la central asume la unidad de más: ${centralAntes} → ${await saldo(A, central.id)}`);
        ok(await saldo(A, destino.id) === 16, 'el destino conserva sus 16 (se le dio la razón)');
        ok(await sumaDelGrupo(t1.trId) === 0, '🔑 el traspaso ya CONSERVA: la suma de sus movimientos es 0');

        const [aj] = await q(`SELECT quantity_change::float8 q, location_id l, transfer_group_id g, description d
                                FROM product_stock_movements
                               WHERE reference_type = 'stock_transfer' AND reference_id = :t AND movement_type = 'AJUSTE'`,
            { t: t1.trId });
        ok(!!aj, 'el cuadre dejó un AJUSTE en el libro');
        ok(aj && aj.l === central.id && aj.q === -1, `en la bodega correcta y por la cantidad correcta (${aj && aj.q})`);
        const [pata] = await q(`SELECT transfer_group_id g FROM product_stock_movements
                                 WHERE reference_id = :t AND movement_type = 'TRASPASO_SALIDA'`, { t: t1.trId });
        ok(aj && pata && aj.g === pata.g, '🔑 y va AMARRADO: mismo transfer_group_id que las dos patas del traspaso');
        ok(aj && /vale lo recibido/i.test(aj.d || ''), `y su nota se explica sola: "${aj && aj.d}"`);
        const [ver] = await q(`SELECT discrepancy_verdict v FROM stock_transfer_items WHERE id = :i`, { i: t1.itemId });
        ok(ver.v === 'RECIBIDO', `el renglón recuerda quién asumió (${ver.v})`);

        r = await cuadrar(t1.trId, t1.itemId, 'ENVIADO');
        ok(r._c === 409, `y no se puede cuadrar dos veces → ${r._c}`);

        // ── 3 ────────────────────────────────────────────────────────────────────
        titulo('3) Recibido de MÁS (15→16) · "vale lo enviado" → asume el DESTINO');
        const B = await producto('ZZZ Novedad B', 100);
        const t2 = await emitirYRecibir(B, 15, 16);
        r = await cuadrar(t2.trId, t2.itemId, 'ENVIADO');
        ok(r._c === 200, `se cuadra → ${r._c}`);
        ok(await saldo(B, destino.id) === 15, `el destino baja a lo enviado: 16 → ${await saldo(B, destino.id)}`);
        ok(await saldo(B, central.id) === 85, 'y la central queda como estaba: perdió los 15 que declaró');
        ok(await sumaDelGrupo(t2.trId) === 0, '🔑 conserva: suma 0');

        // ── 4 ────────────────────────────────────────────────────────────────────
        titulo('4) Recibido de MENOS (15→13) · "vale lo recibido" → el ORIGEN recupera 2');
        const C = await producto('ZZZ Novedad C', 100);
        const t3 = await emitirYRecibir(C, 15, 13);
        ok(await saldo(C, central.id) === 85, 'al emitir, la central perdió los 15 declarados');
        r = await cuadrar(t3.trId, t3.itemId, 'RECIBIDO');
        ok(r._c === 200, `se cuadra → ${r._c}`);
        ok(await saldo(C, central.id) === 87,
            `la central RECUPERA las 2 que nunca salieron: 85 → ${await saldo(C, central.id)}`);
        ok(await saldo(C, destino.id) === 13, 'y el destino se queda con lo que contó');
        ok(await sumaDelGrupo(t3.trId) === 0, '🔑 conserva: suma 0');

        // ── 5 ────────────────────────────────────────────────────────────────────
        titulo('5) Recibido de MENOS (15→13) · "vale lo enviado" → asume el DESTINO');
        const D = await producto('ZZZ Novedad D', 100);
        const t4 = await emitirYRecibir(D, 15, 13);
        r = await cuadrar(t4.trId, t4.itemId, 'ENVIADO');
        ok(r._c === 200, `se cuadra → ${r._c}`);
        ok(await saldo(D, destino.id) === 15,
            `el destino sube a lo enviado: 13 → ${await saldo(D, destino.id)} (y responde por las 2 que no encontró)`);
        ok(await saldo(D, central.id) === 85, 'la central no se toca');
        ok(await sumaDelGrupo(t4.trId) === 0, '🔑 conserva: suma 0');

        // ── 6 ────────────────────────────────────────────────────────────────────
        titulo('6) 🔴 Si la bodega que asume NO tiene con qué, la novedad NO se cuadra');
        const E = await producto('ZZZ Novedad E', 15);        // justo 15: se van todas
        const t5 = await emitirYRecibir(E, 15, 16);
        ok(await saldo(E, central.id) === 0, 'la central queda en CERO de ese producto');
        r = await cuadrar(t5.trId, t5.itemId, 'RECIBIDO');
        ok(r._c === 409, `no la deja cuadrar → ${r._c}`);
        ok(/no tiene con qué asumir/i.test((r._p && r._p.message) || ''),
            `y lo dice nombrando bodega y producto: "${r._p && r._p.message}"`);
        [sigue] = await q(`SELECT discrepancy_resolved d FROM stock_transfers WHERE id = :t`, { t: t5.trId });
        ok(sigue.d === false, '🔑 la novedad queda ABIERTA: mejor visible que un hueco silencioso');
        ok(await saldo(E, central.id) === 0, 'y no se movió nada: ningún ajuste a medias');

        await exec(`INSERT INTO product_stock_movements
                        (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                    VALUES (:c, :p, :l, 5, 'ENTRADA', 'manual', 'carga de prueba novedad', now())`,
            { c: COMPANY, p: E, l: central.id });
        r = await cuadrar(t5.trId, t5.itemId, 'RECIBIDO');
        ok(r._c === 200, `y en cuanto hay existencias, la MISMA novedad sí se cuadra → ${r._c}`);
        ok(await saldo(E, central.id) === 4, `la central asume la unidad: 5 → ${await saldo(E, central.id)}`);
        ok(await sumaDelGrupo(t5.trId) === 0, '🔑 conserva: suma 0');

        // ── 7 ────────────────────────────────────────────────────────────────────
        titulo('7) Traspaso con VARIOS renglones: solo piden veredicto los descuadrados');
        const F = await producto('ZZZ Novedad F', 100);
        const G = await producto('ZZZ Novedad G', 100);
        r = res();
        await ctrl.createTransfer({
            user,
            body: {
                from_location_id: central.id, to_location_id: destino.id,
                items: [{ product_id: F, quantity: 10 }, { product_id: G, quantity: 20 }],
            },
        }, r);
        const t6 = r._p.transfer.id; traspasosCreados.push(t6);
        const its = await q(`SELECT id, product_id FROM stock_transfer_items WHERE transfer_id = :t ORDER BY id`, { t: t6 });
        const itF = its.find((i) => i.product_id === F), itG = its.find((i) => i.product_id === G);
        r = res();
        await ctrl.receiveTransfer({
            user, params: { id: String(t6) },
            body: {
                items: [{ item_id: itF.id, received_quantity: 10 }, { item_id: itG.id, received_quantity: 18 }],
                reception_notes: 'faltaron 2 de G',
            },
        }, r);
        ok(r._c === 200, 'se recibe con UN solo renglón descuadrado');

        r = res();
        await ctrl.resolveDiscrepancy({
            user, params: { id: String(t6) },
            body: { verdicts: [{ item_id: itF.id, verdict: 'ENVIADO' }, { item_id: itG.id, verdict: 'ENVIADO' }] },
        }, r);
        ok(r._c === 400, `dar veredicto de un renglón que SÍ cuadraba se rechaza → ${r._c}`);

        r = await cuadrar(t6, itG.id, 'ENVIADO');
        ok(r._c === 200, `con el veredicto del descuadrado basta → ${r._c}`);
        ok(await saldo(F, destino.id) === 10, 'el renglón que cuadraba no se tocó');
        ok(await saldo(G, destino.id) === 20, `y el descuadrado sube a lo enviado: 18 → ${await saldo(G, destino.id)}`);
        const [ajustes] = await q(`SELECT count(*)::int n FROM product_stock_movements
                                    WHERE reference_type = 'stock_transfer' AND reference_id = :t AND movement_type = 'AJUSTE'`,
            { t: t6 });
        ok(ajustes.n === 1, `se generó UN solo ajuste, no dos (${ajustes.n})`);

        // ── 8 ────────────────────────────────────────────────────────────────────
        titulo('8) El invariante de siempre: saldo guardado = suma de sus movimientos');
        const cuadre = await q(`
            SELECT b.balance::float8 saldo, coalesce(m.s, 0)::float8 libro
              FROM product_stock_balances b
              LEFT JOIN (SELECT product_id, location_id, sum(quantity_change) s
                           FROM product_stock_movements GROUP BY 1, 2) m
                     ON m.product_id = b.product_id AND m.location_id = b.location_id`);
        ok(cuadre.every((f) => f.saldo === f.libro),
            `en las ${cuadre.length} filas de saldo, el guardado = la suma de sus movimientos`);
        const [neg] = await q(`SELECT count(*)::int n FROM product_stock_balances WHERE balance < 0`);
        ok(neg.n === 0, 'ningún saldo negativo en la base');

    } finally {
        for (const t of traspasosCreados) {
            await product_stock_movements.destroy({ where: { reference_type: 'stock_transfer', reference_id: t } });
            await stock_transfer_items.destroy({ where: { transfer_id: t }, force: true });
            await stock_transfers.destroy({ where: { id: t }, force: true, userId: 'limpieza' });
        }
        for (const p of prodsCreados) {
            await exec(`DELETE FROM product_stock_movements WHERE product_id = :p`, { p });
            await exec(`DELETE FROM product_stock_balances WHERE product_id = :p`, { p });
            await products.destroy({ where: { id: p }, force: true });
        }
        for (const b of bodegasCreadas) await inventory_locations.destroy({ where: { id: b }, force: true });
        const [sobras] = await q(`SELECT (SELECT count(*)::int FROM products WHERE sku LIKE 'TEST-NOV-%') p,
                                         (SELECT count(*)::int FROM inventory_locations WHERE name LIKE 'ZZZ Camion de prueba%') b,
                                         (SELECT count(*)::int FROM product_stock_movements WHERE description = 'carga de prueba novedad') m`);
        console.log(`\n🧹 Limpieza: ${traspasosCreados.length} traspasos, ${prodsCreados.length} productos, ${bodegasCreadas.length} bodegas · sobras: ${sobras.p}/${sobras.b}/${sobras.m}`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
