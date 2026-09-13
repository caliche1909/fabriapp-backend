require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * VENTAS APARTADAS — la venta que ya no cabía se guarda igual (OFFLINE-CAMPO.md §11).
 *
 * Lo que hay que demostrar:
 *   · Que la venta EXISTE en Postgres con su importe, sus items y el motivo.
 *   · Que NO cuenta: fuera de los informes, sin mover stock y sin tocar la parada.
 *   · Que el reintento con el mismo uuid no crea una segunda.
 *   · Que la raya se respeta: una peticion mal formada se sigue RECHAZANDO.
 *
 * 🔴 TOCA LA BASE DE DATOS. Crea una visita, un reporte de no compra y unas ventas de prueba, y
 *    LO BORRA TODO al final (incluso si algo falla). No correr contra una BD en uso.
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
    const ventasCreadas = [];
    let visitaId = null, reporteId = null;

    try {
        // ── Datos reales de la BD (no se modifican) ───────────────────────────────
        const [comp] = await q(`
            SELECT c.id, c.name FROM companies c
              JOIN products p ON p.company_id = c.id AND p.is_active AND p.sale_price > 0
             GROUP BY c.id ORDER BY count(p.id) DESC LIMIT 1`);
        const [{ id: userId }] = await q(
            `SELECT user_id id FROM user_companies WHERE company_id=:c AND user_type='owner' LIMIT 1`, { c: comp.id });
        const [tienda] = await q(`SELECT id, name FROM stores WHERE company_id=:c LIMIT 1`, { c: comp.id });
        const [otraTienda] = await q(`SELECT id FROM stores WHERE company_id=:c AND id <> :t LIMIT 1`, { c: comp.id, t: tienda.id });
        const [pago] = await q(`SELECT id FROM payment_methods WHERE company_id=:c OR is_global=true LIMIT 1`, { c: comp.id });
        const [prod] = await q(`SELECT id, name, sale_price::float8 precio FROM products
                                 WHERE company_id=:c AND is_active AND sale_price>0 ORDER BY id LIMIT 1`, { c: comp.id });
        const [cat] = await q(`SELECT id FROM no_sale_categories LIMIT 1`);
        const [razon] = await q(`SELECT id FROM no_sale_reasons LIMIT 1`);

        console.log(`\nCompañía "${comp.name}" · tienda "${tienda.name}" · producto "${prod.name}" ($${prod.precio})`);

        const user = { id: userId, companyId: comp.id, userType: 'owner', permissions: [], companySalesInventoryMode: 'sin_inventario' };
        const CANT = 3;
        const esperado = Math.round(CANT * prod.precio * 100) / 100;

        // Una parada de prueba, en una fecha que no estorba a ningún informe real.
        const DIA = '2099-01-15';
        const [v] = await q(`
            INSERT INTO store_visits (user_id, store_id, date, visit_day, status, sale_amount, created_at, updated_at)
            VALUES (:u, :s, now(), :d, 'pending', 0, now(), now()) RETURNING id`, { u: userId, s: tienda.id, d: DIA });
        visitaId = v.id;

        // Y un reporte de no compra sobre ella: ese es el conflicto que se va a provocar.
        const [rep] = await q(`
            INSERT INTO store_no_sale_reports (visit_id, store_id, user_id, company_id, category_id, reason_id, comments, created_at, updated_at)
            VALUES (:v, :s, :u, :c, :cat, :r, 'prueba automatica', now(), now()) RETURNING id`,
            { v: visitaId, s: tienda.id, u: userId, c: comp.id, cat: cat.id, r: razon.id });
        reporteId = rep.id;

        const totalesDeLaTienda = async () => {
            const [t] = await q(`SELECT COALESCE(SUM(total_amount),0)::float8 total
                                   FROM sales WHERE store_id=:s AND deleted_at IS NULL`, { s: tienda.id });
            return t.total;
        };
        const totalAntes = await totalesDeLaTienda();

        // ── 1) La venta que ya no cabe se GUARDA, no se pierde ────────────────────
        titulo('1) La parada ya se cerro con no compra: la venta se guarda APARTADA');
        const idOp = uuid();
        let r = res();
        await ctrl.createSale({
            user,
            body: {
                store_id: tienda.id, payment_method_id: pago.id, visit_id: visitaId,
                items: [{ product_id: prod.id, quantity: CANT }],
                client_operation_id: idOp, occurred_at: new Date().toISOString(), visit_day: DIA,
            },
        }, r);
        assert(r._c === 200, `responde 200 (no un 4xx): ${r._c}`);
        assert(r._p.success === true, 'success = true: para la cola es una entrega');
        assert(r._p.code === 'REGISTRADA_CON_CONFLICTO', `code = ${r._p.code}`);
        assert(!!r._p.data.conflict_reason, 'con el motivo, que es lo que el supervisor necesita');
        assert(r._p.data.visit_sale_amount === null, 'y sin importe de parada: no suma');
        if (r._p.data?.id) ventasCreadas.push(r._p.data.id);

        titulo('2) La fila existe, completa y apartada');
        const [fila] = await q(`SELECT id, total_amount::float8 total, deleted_at, deleted_by, conflict_reason,
                                       visit_id, status, location_id
                                  FROM sales WHERE client_operation_id = :o`, { o: idOp });
        assert(!!fila, 'la venta existe en Postgres');
        assert(fila.total === esperado, `con su importe real ($${fila.total})`);
        assert(fila.deleted_at !== null, '🔴 nacio con deleted_at: fuera de todos los informes');
        assert(fila.deleted_by === null, 'y con deleted_by NULL: nadie la borro, nacio asi');
        assert(!!fila.conflict_reason, 'con el motivo guardado');
        assert(fila.visit_id === visitaId, 'y ligada a su parada');
        const [items] = await q(`SELECT count(*)::int n FROM sale_items WHERE sale_id = :s`, { s: fila.id });
        assert(items.n === 1, '🔴 los items SI se guardan: sin el detalle la incidencia no sirve');

        titulo('3) NO cuenta en ninguna parte');
        assert((await totalesDeLaTienda()) === totalAntes, 'el total de la tienda no se movio');
        const [visita] = await q(`SELECT status, sale_amount::float8 monto FROM store_visits WHERE id=:v`, { v: visitaId });
        assert(visita.status === 'pending', '🔴 la parada NO se cerro');
        assert(visita.monto === 0, 'ni acumulo el importe');
        const [mov] = await q(`SELECT count(*)::int n FROM product_stock_movements WHERE reference_type='sale' AND reference_id=:s`, { s: fila.id });
        assert(mov.n === 0, 'y no genero movimientos de stock');

        titulo('4) El reintento con el MISMO uuid no crea una segunda');
        r = res();
        await ctrl.createSale({
            user,
            body: {
                store_id: tienda.id, payment_method_id: pago.id, visit_id: visitaId,
                items: [{ product_id: prod.id, quantity: CANT }],
                client_operation_id: idOp, occurred_at: new Date().toISOString(), visit_day: DIA,
            },
        }, r);
        assert(r._p.code === 'REGISTRADA_CON_CONFLICTO', '🔴 vuelve a decir que quedo apartada');
        assert(!!r._p.data.conflict_reason, 'y repite el motivo');
        const [cuenta] = await q(`SELECT count(*)::int n FROM sales WHERE client_operation_id=:o`, { o: idOp });
        assert(cuenta.n === 1, 'sigue habiendo UNA sola venta');

        // ── 5) La raya: lo que NO se aparta ───────────────────────────────────────
        titulo('5) 🔴 La raya: una peticion mal formada se sigue RECHAZANDO');
        r = res();
        await ctrl.createSale({
            user,
            body: {
                store_id: otraTienda.id, payment_method_id: pago.id, visit_id: visitaId, // visita de OTRA tienda
                items: [{ product_id: prod.id, quantity: 1 }],
                client_operation_id: uuid(), occurred_at: new Date().toISOString(), visit_day: DIA,
            },
        }, r);
        assert(r._c === 400, `responde 400: ${r._c}`);
        assert(r._p.code === 'DATOS_INVALIDOS', 'con DATOS_INVALIDOS: eso no es un conflicto, es basura');
        const [basura] = await q(`SELECT count(*)::int n FROM sales WHERE store_id=:s AND conflict_reason IS NOT NULL`, { s: otraTienda.id });
        assert(basura.n === 0, 'y NO se guardo nada');

        // ── 6) Sin regresiones ────────────────────────────────────────────────────
        titulo('6) Una venta normal sigue funcionando igual');
        const [v2] = await q(`
            INSERT INTO store_visits (user_id, store_id, date, visit_day, status, sale_amount, created_at, updated_at)
            VALUES (:u, :s, now(), :d, 'pending', 0, now(), now()) RETURNING id`, { u: userId, s: tienda.id, d: '2099-01-16' });
        r = res();
        await ctrl.createSale({
            user,
            body: {
                store_id: tienda.id, payment_method_id: pago.id, visit_id: v2.id,
                items: [{ product_id: prod.id, quantity: CANT }],
                client_operation_id: uuid(), occurred_at: new Date().toISOString(), visit_day: '2099-01-16',
            },
        }, r);
        assert(r._c === 201, `responde 201: ${r._c}`);
        assert(!r._p.code, 'sin code de conflicto');
        assert(r._p.data.visit_sale_amount === esperado, 'y la parada SI acumula el importe');
        if (r._p.data?.id) ventasCreadas.push(r._p.data.id);
        const [visita2] = await q(`SELECT status FROM store_visits WHERE id=:v`, { v: v2.id });
        assert(visita2.status === 'completed', 'y se cierra, como siempre');
        const [nueva] = await q(`SELECT conflict_reason, deleted_at FROM sales WHERE id=:s`, { s: r._p.data.id });
        assert(nueva.conflict_reason === null && nueva.deleted_at === null, 'la venta normal no lleva marca alguna');
        await exec(`DELETE FROM store_visits WHERE id = :v`, { v: v2.id });


        // ── 7) El endpoint que ve el supervisor ───────────────────────────────────
        titulo('7) GET /reports/conflicts: la lista del supervisor');
        const reportes = require(RAIZ_SERVER + '/src/controllers/sales_reports_controller.js');
        const userLista = { companyId: comp.id, companyTimezone: 'America/Bogota' };

        r = res();
        await reportes.getConflictSales({ user: userLista, query: {} }, r);
        assert(r._c === 200, `responde 200: ${r._c}`);
        const conflictos = r._p.data;
        assert(r._p.total === 1, `hay 1 venta con conflicto: ${r._p.total}`);
        assert(conflictos.length === 1, 'y viene 1 fila');
        assert(!!conflictos[0].conflict_reason, '🔴 con el MOTIVO: es lo que deja actuar a una persona');
        assert(conflictos[0].total_amount === esperado, `con su importe ($${conflictos[0].total_amount})`);
        assert(conflictos[0].store_name === tienda.name, 'la tienda');
        assert(conflictos[0].item_count === 1, 'y cuantos productos llevaba');

        titulo('8) 🔴 La venta NORMAL no aparece ahi');
        const idsConflicto = conflictos.map((c) => c.id);
        assert(!idsConflicto.includes(ventasCreadas[ventasCreadas.length - 1]),
            'la venta buena creada en el paso 6 no esta en la lista');

        titulo('9) 🔴 NO se filtra por fecha: la vieja sigue apareciendo');
        // Es una lista de TAREAS, no un informe. Si siguiera el rango del historial, la venta de
        // hace semanas que nadie resolvio desapareceria justo cuando se mira "esta semana".
        await exec(`UPDATE sales SET sale_date = now() - interval '60 days' WHERE id = :s`, { s: conflictos[0].id });
        r = res();
        await reportes.getConflictSales({ user: userLista, query: {} }, r);
        assert(r._p.total === 1, 'con 60 dias de antiguedad sigue en la lista');
        assert(r._p.data[0].id === conflictos[0].id, 'y es la misma');

        titulo('10) La compañia de al lado no ve nada');
        const [otraComp] = await q(`SELECT id FROM companies WHERE id <> :c LIMIT 1`, { c: comp.id });
        if (otraComp) {
            r = res();
            await reportes.getConflictSales({ user: { companyId: otraComp.id, companyTimezone: 'America/Bogota' }, query: {} }, r);
            assert(r._p.total === 0, 'otra compañia: 0 ventas con conflicto');
        } else {
            assert(true, '(solo hay una compañia en esta BD: no se puede comprobar)');
        }

    } finally {
        // 🧹 Limpieza: se borra TODO lo creado, pase lo que pase.
        for (const id of ventasCreadas) {
            await exec(`DELETE FROM sale_items WHERE sale_id = :s`, { s: id });
            await exec(`DELETE FROM sales WHERE id = :s`, { s: id });
        }
        if (reporteId) await exec(`DELETE FROM store_no_sale_reports WHERE id = :r`, { r: reporteId });
        if (visitaId) await exec(`DELETE FROM store_visits WHERE id = :v`, { v: visitaId });
        const [resto] = await q(`SELECT count(*)::int n FROM sales WHERE conflict_reason IS NOT NULL`);
        console.log(`\n🧹 Limpieza: quedan ${resto.n} ventas apartadas en la BD (debe ser 0).`);
        await sequelize.close();
    }

    console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + e.message + '\n' + e.stack); process.exit(1); });
