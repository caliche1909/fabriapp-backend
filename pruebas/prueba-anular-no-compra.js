require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * 🚫➡️💰 ANULAR UN REPORTE DE NO COMPRA PARA PODER VENDER.
 *
 * EL CASO REAL. El tendero no compra, el vendedor reporta la no compra, y al rato el tendero lo
 * llama y sí le compra. Hasta ahora esa venta **no se rechazaba: se guardaba apartada**, fuera de
 * todos los informes. Medido el 2026-09-15: las **4** ventas apartadas de todo el histórico son
 * exactamente este caso. Diseño completo en `OFFLINE-CAMPO.md` §14.
 *
 * LO QUE SE COMPRUEBA, y por qué está todo en una batería: la anulación no vale por sí misma, vale
 * porque **después la venta entra**. Probar el endpoint por su lado diría que devuelve 200 sin
 * decir si sirvió para algo. El bloque F es la prueba de verdad: la misma venta, antes y después.
 *
 * 🔴 DOS COSAS QUE NO SE VEN EN EL "CAMINO FELIZ" Y AQUÍ SÍ:
 *   · **El orden de las preguntas** (bloque D). "¿Ya está resuelto?" va ANTES que "¿eres el
 *     encargado?". Es la lección del 2026-09-11, que costó 6.212 paradas mal rechazadas: la
 *     autorización mira al encargado de AHORA, así que una anulación que sale de la cola tras
 *     reasignar la ruta se llevaría un rechazo definitivo por algo que ya estaba hecho.
 *   · **Una parada cerrada con VENTA no se degrada** (bloque H), aunque tenga un reporte encima.
 *
 * SEGURIDAD: monta su propio escenario (ruta y tiendas nuevas 'PRUEBA-AN ...'), no toca ninguna
 * fila existente y borra lo suyo al final, pase lo que pase.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const noVentaCtl = require(path.join(SERVER, 'src', 'controllers', 'store_no_sale_reports_controller.js'));
const ventasCtl = require(path.join(SERVER, 'src', 'controllers', 'sales_controller.js'));
const {
    stores, routes, store_visits, routes_stores, sales, sale_items,
    store_no_sale_reports, products, payment_methods, no_sale_categories, sequelize,
} = models;

sequelize.options.logging = false;

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };
const titulo = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`);
const uuid = () => require('crypto').randomUUID();

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.set = () => r;
    return r;
};

(async () => {
    const creado = { stores: [], routes: [] };
    try {
        // ══ Escenario ═══════════════════════════════════════════════════════════════════
        // Hace falta una compañía con productos vendibles: el bloque F registra ventas de verdad.
        const [compania] = await sequelize.query(
            `SELECT c.id, COALESCE(c.timezone,'America/Bogota') AS tz FROM companies c
               JOIN products p ON p.company_id = c.id AND p.deleted_at IS NULL
                              AND p.sale_price > 0 AND p.is_active
              GROUP BY c.id, c.timezone HAVING count(p.id) > 0 LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT });
        if (!compania) throw new Error('No hay una compañía con productos vendibles.');
        const companyId = compania.id;
        const tz = compania.tz;

        const miembros = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id=:cid AND status='active' LIMIT 2`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } });
        const vendedor = miembros[0].user_id;
        const ajeno = miembros[1] ? miembros[1].user_id : null;

        const producto = await products.findOne({ where: { company_id: companyId, is_active: true }, order: [['id', 'ASC']] });
        const metodo = await payment_methods.findOne();
        const categoria = await no_sale_categories.findOne();
        const [motivo] = await sequelize.query(
            `SELECT id FROM no_sale_reasons WHERE category_id=:c LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT, replacements: { c: categoria.id } });

        const [{ hoy }] = await sequelize.query(
            `SELECT to_char((now() AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS hoy`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const ruta = await routes.create({
            name: 'PRUEBA-AN Ruta', company_id: companyId, user_id: vendedor,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(ruta.id);

        const mkTienda = async (etiqueta) => {
            const t = await stores.create({
                name: `PRUEBA-AN ${etiqueta}`, company_id: companyId, address: 'Calle falsa 123',
                store_type_id: 1, latitude: 1.2136, longitude: -77.2811,
            });
            creado.stores.push(t.id);
            await routes_stores.create({ route_id: ruta.id, store_id: t.id, company_id: companyId });
            return t;
        };
        // La parada nace 'visited': marcada y sin concluir, que es desde donde se reporta o se vende.
        const mkParada = (tienda) => store_visits.create({
            user_id: vendedor, store_id: tienda.id, route_id: ruta.id, visit_day: hoy,
            date: new Date(), status: 'visited', store_name: tienda.name,
            store_address: tienda.address, route_name: ruta.name, sale_amount: 0,
        });

        // `sin_inventario` evita montar bodega y existencias: lo que se prueba aquí es la
        // anulación, no el descuento de stock (eso lo cubren las baterías de los tres modos).
        const user = {
            id: vendedor, companyId, companyTimezone: tz, userType: 'collaborator',
            permissions: [], companySalesInventoryMode: 'sin_inventario',
        };
        const userAjeno = ajeno ? { ...user, id: ajeno } : null;

        const reportar = async (tienda, parada, quien = user) => {
            const r = resFalso();
            await noVentaCtl.createNoSaleReport({
                user: quien,
                body: {
                    visit_id: parada.id, store_id: tienda.id, route_id: ruta.id,
                    category_id: categoria.id, reason_id: motivo.id,
                    comments: 'PRUEBA-AN no compra', client_operation_id: uuid(),
                },
            }, r);
            return r;
        };
        const anular = async (visitId, { quien = user, operacion, cia } = {}) => {
            const r = resFalso();
            await noVentaCtl.annulNoSaleReport({
                user: { ...(quien || user), ...(cia ? { companyId: cia } : {}) },
                body: { visit_id: visitId, ...(operacion ? { client_operation_id: operacion } : {}) },
            }, r);
            return r;
        };
        const vender = async (tienda, parada, cantidad = 1) => {
            const r = resFalso();
            await ventasCtl.createSale({
                user,
                body: {
                    store_id: tienda.id, payment_method_id: metodo.id, route_id: ruta.id,
                    visit_id: parada.id, items: [{ product_id: producto.id, quantity: cantidad }],
                    client_operation_id: uuid(),
                },
            }, r);
            return r;
        };
        const estadoDe = async (id) => (await store_visits.findByPk(id)).status;
        const dime = (r) => `${r.statusCode} ${r.body?.code ?? ''} — "${r.body?.message}"`;

        console.log(`\nRuta ${ruta.id} · día ${hoy} · producto "${producto.name}"`);

        // ══ A) Validaciones ═════════════════════════════════════════════════════════════
        titulo('A) Lo que ni siquiera se intenta');

        const a1 = await anular(undefined);
        assert(a1.statusCode === 400 && a1.body.code === 'DATOS_INVALIDOS', `sin visit_id → ${dime(a1)}`);
        const a2 = await anular('12a');
        assert(a2.statusCode === 400 && a2.body.code === 'DATOS_INVALIDOS', `visit_id que no es un número → ${dime(a2)}`);

        // ══ B) Los tres desenlaces buenos ═══════════════════════════════════════════════
        titulo('B) Los tres caminos de éxito');

        const t1 = await mkTienda('T1 con reporte');
        const p1 = await mkParada(t1);

        // 🔴 "No hay nada que anular" es un ÉXITO, no un error: el objetivo es que la parada quede
        // libre para vender, y ya lo está. Si fuera error, la cola lo reintentaría para siempre y
        // bloquearía la venta que depende de él (§14.5).
        const b0 = await anular(p1.id);
        assert(b0.statusCode === 200 && b0.body.code === 'NADA_QUE_ANULAR',
            `parada SIN reporte → 200 NADA_QUE_ANULAR, no un error → ${dime(b0)}`);

        const rep1 = await reportar(t1, p1);
        assert(rep1.statusCode === 201, `se reporta la no compra → ${rep1.statusCode}`);
        assert(await estadoDe(p1.id) === 'completed', 'la parada queda CERRADA por el reporte');

        const b1 = await anular(p1.id);
        assert(b1.statusCode === 200 && !b1.body.code, `anular un reporte vivo → ${dime(b1)}`);
        assert(b1.body?.data?.status === 'visited', 'la respuesta dice que la parada vuelve a `visited`');
        assert(await estadoDe(p1.id) === 'visited', 'y en la base también: marcada, pero sin concluir');

        const enBD = await store_no_sale_reports.findOne({ where: { visit_id: p1.id } });
        assert(enBD.annulled_at !== null, 'el reporte se MARCA como anulado, no se borra');
        assert(enBD.annulled_by === vendedor, 'y queda quién lo anuló');

        const b2 = await anular(p1.id);
        assert(b2.statusCode === 200 && b2.body.code === 'NADA_QUE_ANULAR',
            `anular lo ya anulado → 200 NADA_QUE_ANULAR → ${dime(b2)}`);

        // ══ C) Idempotencia ════════════════════════════════════════════════════════════
        titulo('C) El mismo envío dos veces');

        const t2 = await mkTienda('T2 idempotencia');
        const p2 = await mkParada(t2);
        await reportar(t2, p2);

        const op = uuid();
        const c1 = await anular(p2.id, { operacion: op });
        assert(c1.statusCode === 200, `primera anulación con uuid → ${c1.statusCode}`);
        const c2 = await anular(p2.id, { operacion: op });
        assert(c2.statusCode === 200 && c2.body.code === 'YA_REGISTRADO',
            `el MISMO uuid otra vez → 200 YA_REGISTRADO (nuestro propio reintento) → ${dime(c2)}`);
        const [{ n }] = await sequelize.query(
            `SELECT count(*)::int AS n FROM store_no_sale_reports WHERE annulled_operation_id = :op`,
            { type: sequelize.QueryTypes.SELECT, replacements: { op } });
        assert(n === 1, `y hay UNA sola anulación con ese identificador (${n})`);

        // ══ D) El orden de las preguntas ═══════════════════════════════════════════════
        titulo('D) Primero "¿ya está hecho?", después "¿eres el encargado?"');

        if (userAjeno) {
            // 🔴 LA LECCIÓN DEL 2026-09-11. La cola de un vendedor se vacía horas después, cuando
            // la ruta ya se reasignó. Si se preguntara primero por el encargado, esta anulación
            // —de algo YA anulado— se llevaría un rechazo definitivo con su alarma roja.
            const d1 = await anular(p1.id, { quien: userAjeno });
            assert(d1.statusCode === 200 && d1.body.code === 'NADA_QUE_ANULAR',
                `un ajeno sobre algo YA anulado → 200, no 403 → ${dime(d1)}`);

            const t3 = await mkTienda('T3 ajeno');
            const p3 = await mkParada(t3);
            await reportar(t3, p3);
            const d2 = await anular(p3.id, { quien: userAjeno });
            assert(d2.statusCode === 403 && d2.body.code === 'NO_ES_ENCARGADO',
                `pero sobre un reporte VIVO sí se le para → 403 → ${dime(d2)}`);
            const sigueVivo = await store_no_sale_reports.findOne({ where: { visit_id: p3.id } });
            assert(sigueVivo.annulled_at === null, 'y el reporte sigue vivo: no escribió nada');
        } else {
            console.log('   (sin un segundo miembro en la compañía: no se puede probar el ajeno)');
        }

        // ══ E) Aislamiento entre compañías ═════════════════════════════════════════════
        titulo('E) Una compañía no ve los reportes de otra');

        const t4 = await mkTienda('T4 aislamiento');
        const p4 = await mkParada(t4);
        await reportar(t4, p4);
        const e1 = await anular(p4.id, { cia: '00000000-0000-4000-8000-000000000000' });
        assert(e1.statusCode === 200 && e1.body.code === 'NADA_QUE_ANULAR',
            `con otra compañía el reporte "no existe" — no se filtra que sí → ${dime(e1)}`);
        const intacto = await store_no_sale_reports.findOne({ where: { visit_id: p4.id } });
        assert(intacto.annulled_at === null, 'y desde luego no se anuló');

        // ══ F) PARA LO QUE EXISTE TODO ESTO ════════════════════════════════════════════
        titulo('F) La misma venta, antes y después de anular');

        const t5 = await mkTienda('T5 la venta');
        const p5 = await mkParada(t5);
        await reportar(t5, p5);

        const f1 = await vender(t5, p5);
        assert(f1.statusCode === 200 && f1.body.code === 'REGISTRADA_CON_CONFLICTO',
            `con el reporte vivo la venta se APARTA (el problema original) → ${dime(f1)}`);
        assert(Number((await store_visits.findByPk(p5.id)).sale_amount) === 0,
            'y no suma nada a la parada: no cuenta en ningún informe');

        const f2 = await anular(p5.id);
        assert(f2.statusCode === 200 && !f2.body.code, `se anula el reporte → ${dime(f2)}`);

        const f3 = await vender(t5, p5, 2);
        assert(f3.statusCode === 201 && !f3.body.code,
            `y AHORA la venta entra normal, sin conflicto → ${dime(f3)}`);
        const paradaVendida = await store_visits.findByPk(p5.id);
        assert(paradaVendida.status === 'completed', 'la parada se cierra con la venta');
        assert(Number(paradaVendida.sale_amount) === Number(producto.sale_price) * 2,
            `y el importe sí suma (${paradaVendida.sale_amount})`);

        // ══ G) Volver a reportar después de anular ═════════════════════════════════════
        titulo('G) Si al final tampoco compra, se puede volver a reportar');

        // Esto es lo que obliga a que el índice único sea PARCIAL (`AND annulled_at IS NULL`).
        // Con el índice estricto, la tienda que se arrepiente dos veces quedaba bloqueada.
        const t6 = await mkTienda('T6 reintento');
        const p6 = await mkParada(t6);
        await reportar(t6, p6);
        await anular(p6.id);
        const g1 = await reportar(t6, p6);
        assert(g1.statusCode === 201, `se reporta otra vez sobre la misma visita → ${dime(g1)}`);
        const cuantos = await store_no_sale_reports.count({ where: { visit_id: p6.id } });
        const vivos = await store_no_sale_reports.count({ where: { visit_id: p6.id, annulled_at: null } });
        assert(cuantos === 2 && vivos === 1, `quedan 2 reportes y solo 1 vivo (${cuantos}/${vivos})`);
        assert(await estadoDe(p6.id) === 'completed', 'y la parada vuelve a cerrarse');

        // ══ H) Una parada cerrada con VENTA no se degrada ══════════════════════════════
        titulo('H) Anular no puede retroceder una parada que sí se vendió');

        // ⚠️ ESTADO ARTIFICIAL A PROPÓSITO: el reporte se inserta a mano porque por el camino
        // normal no se puede (`createNoSaleReport` lo rechaza con `VENTA_YA_REGISTRADA`). Medido
        // el 2026-09-15 no existe ni un caso en el histórico. Se prueba igual porque si algún día
        // aparece, degradar a `visited` una parada con venta sería inventarse un retroceso.
        const t7 = await mkTienda('T7 con venta');
        const p7 = await mkParada(t7);
        const h0 = await vender(t7, p7);
        assert(h0.statusCode === 201, `venta normal → ${h0.statusCode}`);
        await store_no_sale_reports.create({
            visit_id: p7.id, store_id: t7.id, user_id: vendedor, route_id: ruta.id,
            company_id: companyId, category_id: categoria.id, reason_id: motivo.id,
            comments: 'PRUEBA-AN estado imposible',
        });

        const h1 = await anular(p7.id);
        assert(h1.statusCode === 200 && h1.body?.data?.status === 'completed',
            `se anula, pero la parada se queda COMPLETED → ${dime(h1)}`);
        assert(await estadoDe(p7.id) === 'completed', 'y en la base sigue cerrada con su venta');

    } catch (e) {
        console.error('\nERROR:', e.message, e.stack);
        fail++;
    } finally {
        // Limpieza: solo lo creado por esta prueba. Las ventas van primero (sus líneas cuelgan
        // de ellas) y `force` porque `sales` es paranoid: sin él quedarían filas borradas.
        try {
            if (creado.stores.length) {
                const lasVentas = await sales.findAll({
                    where: { store_id: creado.stores }, attributes: ['id'], paranoid: false,
                });
                const ids = lasVentas.map((v) => v.id);
                if (ids.length) {
                    await sale_items.destroy({ where: { sale_id: ids }, force: true });
                    await sales.destroy({ where: { id: ids }, force: true });
                }
                await store_no_sale_reports.destroy({ where: { store_id: creado.stores } });
                await store_visits.destroy({ where: { store_id: creado.stores } });
                await routes_stores.destroy({ where: { store_id: creado.stores } });
                await stores.destroy({ where: { id: creado.stores }, force: true });
            }
            if (creado.routes.length) await routes.destroy({ where: { id: creado.routes }, force: true });
            const [{ n }] = await sequelize.query(
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-AN%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-AN%') AS n`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${n} filas de prueba (debe ser 0).`);
        } catch (e) {
            console.error('LIMPIEZA FALLIDA:', e.message);
        }
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
