require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * FASE 1a — Contrato de sincronizacion (idempotencia, occurred_at, visit_day, codigos).
 *
 * Lo que hay que demostrar, en orden de importancia:
 *   A) La app HOY DESPLEGADA se comporta EXACTAMENTE igual (no manda los campos nuevos).
 *   B) Mandar la misma venta 5 veces crea UNA sola venta.
 *   C) Reintentar una venta ANULADA responde "ya registrado", no un 500.
 *   D) Dos envios simultaneos con el mismo uuid crean UNA sola venta.
 *   E) Las horas y el dia de negocio son los que declara el cliente, acotados.
 *   F) Marcar una visita de AYER funciona (sincronizar pasada la medianoche).
 *   G) Cada rechazo trae su codigo estable.
 *
 * SEGURIDAD: crea SUS PROPIAS rutas/tiendas ('PRUEBA-F1A ...') y las borra al terminar pase lo
 * que pase. No toca ninguna jornada, venta ni reporte real.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const ventas = require(path.join(SERVER, 'src', 'controllers', 'sales_controller.js'));
const tiendasCtl = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const noVentaCtl = require(path.join(SERVER, 'src', 'controllers', 'store_no_sale_reports_controller.js'));
const rutasCtl = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
const {
    stores, routes, store_visits, routes_stores, companies, sales, sale_items,
    store_no_sale_reports, products, payment_methods, no_sale_categories, sequelize,
} = models;

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const titulo = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 66 - t.length)));

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.set = () => r;
    return r;
};
const uuid = () => require('crypto').randomUUID();

(async () => {
    const creado = { stores: [], routes: [] };
    try {
        // ── Montaje ───────────────────────────────────────────────────────────
        const compania = await sequelize.query(
            `SELECT c.id, COALESCE(c.timezone,'America/Bogota') AS tz FROM companies c
              JOIN products p ON p.company_id = c.id AND p.deleted_at IS NULL
                             AND p.sale_price > 0 AND p.is_active
             GROUP BY c.id, c.timezone HAVING count(p.id) > 0 LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT });
        if (!compania.length) throw new Error('No hay una compania con productos vendibles.');
        const companyId = compania[0].id;
        const tz = compania[0].tz;

        const miembros = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id=:cid AND status='active' LIMIT 2`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } });
        const vendedor = miembros[0].user_id;
        const otro = (miembros[1] || miembros[0]).user_id;

        const producto = await products.findOne({ where: { company_id: companyId, is_active: true }, order: [['id', 'ASC']] });
        const metodo = await payment_methods.findOne();
        const categoria = await no_sale_categories.findOne();
        const motivo = (await sequelize.query(
            `SELECT id FROM no_sale_reasons WHERE category_id=:c LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT, replacements: { c: categoria.id } }))[0];

        const [{ hoy, ayer, anteanteayer }] = await sequelize.query(
            `SELECT to_char((now() AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS hoy,
                    to_char((now() AT TIME ZONE :tz)::date - 1,'YYYY-MM-DD') AS ayer,
                    to_char((now() AT TIME ZONE :tz)::date - 5,'YYYY-MM-DD') AS anteanteayer`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const ruta = await routes.create({
            name: 'PRUEBA-F1A Ruta', company_id: companyId, user_id: vendedor,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(ruta.id);

        const mkTienda = async (n) => {
            const s = await stores.create({
                name: `PRUEBA-F1A ${n}`, company_id: companyId, address: `Calle ${n}`, store_type_id: 1,
                opening_time: '6:00 am', closing_time: '8:00 pm',
                ubicacion: sequelize.fn('ST_SetSRID', sequelize.fn('ST_MakePoint', -77.2811, 1.2136), 4326),
            });
            creado.stores.push(s.id);
            await routes_stores.create({ route_id: ruta.id, store_id: s.id, company_id: companyId });
            return s;
        };
        const mkParada = (store, dia) => store_visits.create({
            user_id: vendedor, store_id: store.id, route_id: ruta.id, visit_day: dia,
            date: new Date(), status: 'pending', store_name: store.name, route_name: ruta.name,
        });

        const user = {
            id: vendedor, companyId, companyTimezone: tz, userType: 'collaborator',
            permissions: [], companySalesInventoryMode: 'sin_inventario',
        };
        const userAjeno = { ...user, id: otro };

        console.log(`\nCompania ${companyId} · TZ ${tz} · hoy=${hoy} · producto "${producto.name}"`);

        // ═════════════════════════════════════════════════════════════════════
        titulo('A) COMPATIBILIDAD: sin los campos nuevos, todo igual que hoy');
        const tA = await mkTienda('A');
        const pA = await mkParada(tA, hoy);

        let r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tA.id) }, body: { distance: 12, visit_id: pA.id }, user }, r);
        assert(r.statusCode === 200, `marcar sin campos nuevos -> 200 ("${r.body?.message}")`);
        await pA.reload();
        assert(pA.status === 'visited', 'la parada queda visited');
        assert(pA.client_operation_id === null && pA.synced_at === null,
            'client_operation_id y synced_at quedan NULL (fila idéntica a las de antes)');
        assert(Math.abs(new Date(pA.arrived_at) - Date.now()) < 60000, 'arrived_at = ahora, como siempre');

        r = resFalso();
        await ventas.createSale({ user, body: { store_id: tA.id, payment_method_id: metodo.id, route_id: ruta.id, visit_id: pA.id, items: [{ product_id: producto.id, quantity: 1 }] } }, r);
        assert(r.statusCode === 201, `vender sin campos nuevos -> 201 ("${r.body?.message}")`);
        const ventaA = await sales.findByPk(r.body.data.id);
        assert(ventaA.client_operation_id === null && ventaA.synced_at === null, 'la venta queda con las columnas nuevas en NULL');
        assert(Math.abs(new Date(ventaA.sale_date) - Date.now()) < 60000, 'sale_date = ahora (defaultValue intacto)');
        await pA.reload();
        assert(pA.status === 'completed' && Number(pA.sale_amount) > 0, 'la visita se cierra y acumula el monto, como siempre');

        // ═════════════════════════════════════════════════════════════════════
        titulo('B) La misma venta 5 veces crea UNA sola venta');
        const tB = await mkTienda('B');
        const pB = await mkParada(tB, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tB.id) }, body: { distance: 10, visit_id: pB.id, client_operation_id: uuid() }, user }, r);

        const opVenta = uuid();
        const cuerpoVenta = { store_id: tB.id, payment_method_id: metodo.id, route_id: ruta.id, visit_id: pB.id, items: [{ product_id: producto.id, quantity: 3 }], client_operation_id: opVenta };
        const respuestas = [];
        for (let i = 0; i < 5; i++) {
            const rr = resFalso();
            await ventas.createSale({ user, body: cuerpoVenta }, rr);
            respuestas.push(rr);
        }
        assert(respuestas[0].statusCode === 201, `1er envio -> 201 (venta creada, id ${respuestas[0].body?.data?.id})`);
        assert(respuestas.slice(1).every((x) => x.statusCode === 200 && x.body.code === 'YA_REGISTRADO'),
            'envios 2-5 -> 200 YA_REGISTRADO (no son errores: la cola los da por buenos)');
        assert(respuestas.every((x) => x.body?.data?.id === respuestas[0].body.data.id), 'las 5 respuestas devuelven el MISMO id de venta');
        const nVentasB = await sales.count({ where: { client_operation_id: opVenta }, paranoid: false });
        assert(nVentasB === 1, `en la BD hay ${nVentasB} venta con ese uuid (debe ser 1)`);
        const nItemsB = await sale_items.count({ where: { sale_id: respuestas[0].body.data.id } });
        assert(nItemsB === 1, `y ${nItemsB} linea de venta (no se duplicaron los items)`);
        await pB.reload();
        const montoEsperado = Number(producto.sale_price) * 3;
        assert(Math.abs(Number(pB.sale_amount) - montoEsperado) < 0.01,
            `la visita acumulo ${pB.sale_amount} y no ${montoEsperado * 5} (el monto NO se sumo 5 veces)`);

        // ═════════════════════════════════════════════════════════════════════
        titulo('C) Reintentar una venta ANULADA (el caso que rompia con paranoid)');
        const tC = await mkTienda('C');
        const pC = await mkParada(tC, hoy);
        const opC = uuid();
        r = resFalso();
        await ventas.createSale({ user, body: { store_id: tC.id, payment_method_id: metodo.id, visit_id: null, items: [{ product_id: producto.id, quantity: 1 }], client_operation_id: opC } }, r);
        const idC = r.body.data.id;
        await sales.destroy({ where: { id: idC }, userId: vendedor });
        assert((await sales.findByPk(idC)) === null, 'la venta queda anulada (borrado logico): el findOne normal ya no la ve');
        r = resFalso();
        await ventas.createSale({ user, body: { store_id: tC.id, payment_method_id: metodo.id, visit_id: null, items: [{ product_id: producto.id, quantity: 1 }], client_operation_id: opC } }, r);
        assert(r.statusCode === 200 && r.body.code === 'YA_REGISTRADO',
            `reintento sobre la anulada -> ${r.statusCode} ${r.body?.code} (antes habria sido un 500 por choque de indice)`);
        assert(r.body.data?.anulada === true, 'y avisa que esa venta esta anulada');
        assert(await sales.count({ where: { client_operation_id: opC }, paranoid: false }) === 1, 'sigue habiendo UNA sola fila');

        // ═════════════════════════════════════════════════════════════════════
        titulo('D) Dos envios SIMULTANEOS con el mismo uuid');
        const tD = await mkTienda('D');
        const pD = await mkParada(tD, hoy);
        const opD = uuid();
        const cuerpoD = { store_id: tD.id, payment_method_id: metodo.id, visit_id: null, items: [{ product_id: producto.id, quantity: 2 }], client_operation_id: opD };
        const [d1, d2] = await Promise.all([
            (async () => { const x = resFalso(); await ventas.createSale({ user, body: cuerpoD }, x); return x; })(),
            (async () => { const x = resFalso(); await ventas.createSale({ user, body: cuerpoD }, x); return x; })(),
        ]);
        const nD = await sales.count({ where: { client_operation_id: opD }, paranoid: false });
        assert(nD === 1, `dos peticiones a la vez -> ${nD} venta en la BD (debe ser 1)`);
        assert([d1, d2].every((x) => x.statusCode === 200 || x.statusCode === 201),
            `ninguna respondio error (${d1.statusCode} y ${d2.statusCode}); ningun 500 por el choque del indice`);

        // ═════════════════════════════════════════════════════════════════════
        titulo('E) La hora la pone el cliente, acotada por el servidor');
        const tE = await mkTienda('E');
        const pE = await mkParada(tE, hoy);
        const HACE_5H = new Date(Date.now() - 5 * 60 * 60 * 1000);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tE.id) }, body: { distance: 8, visit_id: pE.id, client_operation_id: uuid(), occurred_at: HACE_5H.toISOString() }, user }, r);
        await pE.reload();
        assert(r.statusCode === 200 && Math.abs(new Date(pE.arrived_at) - HACE_5H) < 2000,
            `arrived_at = la hora que declaro el cliente (${new Date(pE.arrived_at).toLocaleTimeString()}), no la de ahora`);
        assert(pE.synced_at !== null, 'synced_at queda marcado: la fila entro en diferido');

        r = resFalso();
        await ventas.createSale({ user, body: { store_id: tE.id, payment_method_id: metodo.id, visit_id: pE.id, items: [{ product_id: producto.id, quantity: 1 }], client_operation_id: uuid(), occurred_at: HACE_5H.toISOString() } }, r);
        const ventaE = await sales.findByPk(r.body.data.id);
        assert(Math.abs(new Date(ventaE.sale_date) - HACE_5H) < 2000, 'sale_date = la hora real de la venta (es la que filtran los reportes)');
        assert(ventaE.synced_at !== null, 'synced_at marcado');
        assert(Math.abs(new Date(ventaE.createdAt) - Date.now()) < 60000,
            'created_at sigue siendo la hora en que el servidor la recibio (asi se ve el retraso)');

        // Reloj disparatado: no se rechaza el trabajo, se acota.
        const tE2 = await mkTienda('E2');
        const pE2 = await mkParada(tE2, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tE2.id) }, body: { distance: 8, visit_id: pE2.id, client_operation_id: uuid(), occurred_at: '2019-01-01T10:00:00Z' }, user }, r);
        await pE2.reload();
        assert(r.statusCode === 200, 'un telefono con el reloj en 2019 NO pierde su trabajo');
        assert(Math.abs(new Date(pE2.arrived_at) - Date.now()) < 60000, 'la fecha absurda se descarta y se usa la del servidor');
        assert(pE2.synced_at !== null, 'y queda marcada como diferida para poder auditarla');

        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tE2.id) }, body: { distance: 8, visit_id: pE2.id, occurred_at: 'no-es-una-fecha' }, user }, r);
        assert(r.statusCode === 400 && r.body.code === 'DATOS_INVALIDOS', `occurred_at basura -> 400 DATOS_INVALIDOS`);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tE2.id) }, body: { distance: 8, visit_id: pE2.id, client_operation_id: 'no-es-un-uuid' }, user }, r);
        assert(r.statusCode === 400 && r.body.code === 'DATOS_INVALIDOS', 'client_operation_id basura -> 400 DATOS_INVALIDOS');

        // ═════════════════════════════════════════════════════════════════════
        titulo('F) Sincronizar pasada la medianoche: marcar una visita de AYER');
        const tF = await mkTienda('F');
        const pF = await mkParada(tF, ayer);

        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tF.id) }, body: { distance: 15, visit_id: pF.id }, user }, r);
        assert(r.statusCode === 409 && r.body.code === 'VISITA_NO_EXISTE',
            'sin declarar el dia, una parada de ayer se sigue rechazando (protege el historico)');

        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tF.id) }, body: { distance: 15, visit_id: pF.id, visit_day: ayer, client_operation_id: uuid(), occurred_at: new Date(Date.now() - 10 * 3600 * 1000).toISOString() }, user }, r);
        assert(r.statusCode === 200, `declarando visit_day=${ayer} -> 200: la jornada de ayer NO se pierde`);
        await pF.reload();
        assert(pF.status === 'visited' && pF.visit_day === ayer, 'la parada de ayer queda cerrada, en SU dia');

        const tF2 = await mkTienda('F2');
        const pF2 = await mkParada(tF2, anteanteayer);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tF2.id) }, body: { distance: 15, visit_id: pF2.id, visit_day: anteanteayer, client_operation_id: uuid() }, user }, r);
        assert(r.statusCode === 400 && r.body.code === 'DATOS_INVALIDOS',
            `una jornada de hace 5 dias se rechaza con explicacion ("${r.body?.message}")`);
        const [{ manana }] = await sequelize.query(`SELECT to_char((now() AT TIME ZONE :tz)::date + 1,'YYYY-MM-DD') AS manana`, { type: sequelize.QueryTypes.SELECT, replacements: { tz } });
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tF2.id) }, body: { distance: 15, visit_id: pF2.id, visit_day: manana, client_operation_id: uuid() }, user }, r);
        assert(r.statusCode === 400, 'y una fecha futura tambien');

        // ═════════════════════════════════════════════════════════════════════
        titulo('G) Codigos estables en cada rechazo');
        const tG = await mkTienda('G');
        const pG = await mkParada(tG, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tG.id) }, body: { distance: 5, visit_id: pG.id, client_operation_id: uuid() }, user }, r);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tG.id) }, body: { distance: 5, visit_id: pG.id, client_operation_id: uuid() }, user }, r);
        assert(r.statusCode === 409 && r.body.code === 'VISITA_YA_CERRADA',
            'marcar dos veces con uuid DISTINTO -> 409 VISITA_YA_CERRADA (para la cola es exito)');

        // Un ajeno sobre una parada que YA ESTA CERRADA. Antes esto contestaba NO_ES_ENCARGADO,
        // pero era un efecto colateral del orden de los chequeos, no la regla: la parada esta
        // cerrada, que es el desenlace que se buscaba, y no se escribe nada. Contestar "ya esta
        // hecho" es lo correcto, y es lo que evita que la cola de un vendedor cuya ruta se
        // reasigno mientras estaba sin senal se llene de rechazos definitivos falsos.
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tG.id) }, body: { distance: 5, visit_id: pG.id, client_operation_id: uuid() }, user: userAjeno }, r);
        assert(r.statusCode === 409 && r.body.code === 'VISITA_YA_CERRADA',
            `un ajeno sobre una parada CERRADA -> 409 VISITA_YA_CERRADA (${r.body?.code})`);

        // Y la regla de "solo el encargado" sigue intacta donde de verdad importa: sobre una
        // parada ABIERTA, que es la unica que se llega a escribir. Antes esto NO se comprobaba
        // —la asercion de arriba reutilizaba la parada ya cerrada— asi que la regla se daba por
        // probada sin estarlo.
        const tG2 = await mkTienda('G2');
        const pG2 = await mkParada(tG2, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tG2.id) }, body: { distance: 5, visit_id: pG2.id, client_operation_id: uuid() }, user: userAjeno }, r);
        assert(r.statusCode === 403 && r.body.code === 'NO_ES_ENCARGADO' || vendedor === otro,
            `un ajeno sobre una parada ABIERTA -> 403 NO_ES_ENCARGADO (${r.body?.code})`);
        await pG2.reload();
        assert(pG2.status === 'pending' || vendedor === otro,
            'y la parada abierta sigue SIN tocar tras el intento del ajeno');

        // No-venta sobre una visita que YA tiene venta
        r = resFalso();
        await ventas.createSale({ user, body: { store_id: tG.id, payment_method_id: metodo.id, visit_id: pG.id, items: [{ product_id: producto.id, quantity: 1 }], client_operation_id: uuid() } }, r);
        r = resFalso();
        await noVentaCtl.createNoSaleReport({ user, body: { visit_id: pG.id, store_id: tG.id, route_id: ruta.id, category_id: categoria.id, reason_id: motivo.id, comments: 'prueba', client_operation_id: uuid() } }, r);
        assert(r.statusCode === 409 && r.body.code === 'VENTA_YA_REGISTRADA',
            'no-venta sobre una visita ya vendida -> 409 VENTA_YA_REGISTRADA (rechazo real, no reintentar)');

        // ═════════════════════════════════════════════════════════════════════
        titulo('H) Reporte de no compra: idempotencia y hora del cliente');
        const tH = await mkTienda('H');
        const pH = await mkParada(tH, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tH.id) }, body: { distance: 5, visit_id: pH.id, client_operation_id: uuid() }, user }, r);

        const opH = uuid();
        const cuerpoH = { visit_id: pH.id, store_id: tH.id, route_id: ruta.id, category_id: categoria.id, reason_id: motivo.id, comments: 'PRUEBA-F1A no compra', client_operation_id: opH, occurred_at: HACE_5H.toISOString() };
        r = resFalso(); await noVentaCtl.createNoSaleReport({ user, body: cuerpoH }, r);
        assert(r.statusCode === 201, `no-venta -> 201 ("${r.body?.message}")`);
        const r2 = resFalso(); await noVentaCtl.createNoSaleReport({ user, body: cuerpoH }, r2);
        assert(r2.statusCode === 200 && r2.body.code === 'YA_REGISTRADO', 'el reintento -> 200 YA_REGISTRADO');
        assert(await store_no_sale_reports.count({ where: { client_operation_id: opH } }) === 1, 'hay UN solo reporte');
        const repH = await store_no_sale_reports.findOne({ where: { client_operation_id: opH } });
        assert(Math.abs(new Date(repH.created_at) - HACE_5H) < 2000,
            'created_at = la hora declarada (es la fecha de negocio que filtran los reportes de no-venta)');
        assert(repH.synced_at !== null, 'synced_at marcado: es el UNICO rastro de que entro en diferido');

        // ── El ajeno en el REPORTE DE NO COMPRA ────────────────────────────────
        // Estos cuatro casos no los cubria nadie, ni antes ni despues de reordenar los chequeos.
        // El reporte de no compra tiene el mismo problema que marcar: su cola se vacia horas
        // despues, y para entonces la ruta puede estar reasignada.

        // pH quedo CERRADA con un reporte de no-venta (bloque H). Para la cola esto es EXITO:
        // el desenlace que se buscaba ya existe, aunque lo consiguiera otro tras un relevo.
        r = resFalso();
        await noVentaCtl.createNoSaleReport({ user: userAjeno, body: { ...cuerpoH, client_operation_id: uuid() } }, r);
        assert(r.statusCode === 409 && r.body.code === 'NO_VENTA_YA_REGISTRADA',
            `un ajeno sobre parada cerrada con NO-VENTA -> 409 NO_VENTA_YA_REGISTRADA (${r.body?.code})`);

        // pG quedo cerrada con VENTA. Sigue siendo un rechazo REAL —la no-venta no procede— pero
        // ahora lo dice por su motivo verdadero en vez de por "no eres el encargado".
        r = resFalso();
        await noVentaCtl.createNoSaleReport({ user: userAjeno, body: { visit_id: pG.id, store_id: tG.id, route_id: ruta.id, category_id: categoria.id, reason_id: motivo.id, comments: 'PRUEBA-F1A ajeno venta', client_operation_id: uuid() } }, r);
        assert(r.statusCode === 409 && r.body.code === 'VENTA_YA_REGISTRADA',
            `un ajeno sobre parada cerrada con VENTA -> 409 VENTA_YA_REGISTRADA (${r.body?.code})`);

        // Y sobre una parada ABIERTA —marcada pero sin cerrar— la regla del encargado manda
        // entera, porque aqui SI se escribiria.
        const tH2 = await mkTienda('H2');
        const pH2 = await mkParada(tH2, hoy);
        r = resFalso();
        await tiendasCtl.updateStoreAsVisited({ params: { store_id: String(tH2.id) }, body: { distance: 5, visit_id: pH2.id, client_operation_id: uuid() }, user }, r);
        r = resFalso();
        await noVentaCtl.createNoSaleReport({ user: userAjeno, body: { visit_id: pH2.id, store_id: tH2.id, route_id: ruta.id, category_id: categoria.id, reason_id: motivo.id, comments: 'PRUEBA-F1A ajeno abierta', client_operation_id: uuid() } }, r);
        assert(r.statusCode === 403 && r.body.code === 'NO_ES_ENCARGADO' || vendedor === otro,
            `un ajeno sobre parada ABIERTA -> 403 NO_ES_ENCARGADO (${r.body?.code})`);
        await pH2.reload();
        assert(pH2.status === 'visited' || vendedor === otro,
            'y esa parada NO se cierra: la regla sigue protegiendo todo lo que escribe');

        // ═════════════════════════════════════════════════════════════════════
        titulo('I) Los horarios crudos viajan en las visitas del dia');
        const rr = resFalso();
        await rutasCtl.getRouteDayVisits({ params: { route_id: String(ruta.id) }, query: {}, user }, rr);
        const data = rr.body?.data ?? rr.body;
        const unaParada = (data?.visitas || []).find((v) => v.store_id === tA.id);
        assert(rr.statusCode === 200 && unaParada, 'se consultan las visitas del dia');
        assert(unaParada && 'opening_time' in unaParada && 'closing_time' in unaParada,
            `la parada trae opening_time="${unaParada?.opening_time}" y closing_time="${unaParada?.closing_time}"`);
        assert(unaParada && 'estado' in unaParada, 'y sigue trayendo `estado` (aditivo: nada se rompio)');

    } catch (e) {
        console.error('\nERROR: ' + e.message);
        console.error(e.stack.split('\n').slice(1, 5).join('\n'));
        fail++;
    } finally {
        try {
            if (creado.stores.length) {
                const visitas = await store_visits.findAll({ where: { store_id: creado.stores }, attributes: ['id'] });
                const idsVisitas = visitas.map((v) => v.id);
                if (idsVisitas.length) await store_no_sale_reports.destroy({ where: { visit_id: idsVisitas } });
                await store_no_sale_reports.destroy({ where: { store_id: creado.stores } });
                const ventasPrueba = await sales.findAll({ where: { store_id: creado.stores }, attributes: ['id'], paranoid: false });
                if (ventasPrueba.length) {
                    await sale_items.destroy({ where: { sale_id: ventasPrueba.map((v) => v.id) }, force: true });
                    await sales.destroy({ where: { id: ventasPrueba.map((v) => v.id) }, force: true });
                }
                await store_visits.destroy({ where: { store_id: creado.stores } });
                await routes_stores.destroy({ where: { store_id: creado.stores } });
                await stores.destroy({ where: { id: creado.stores }, force: true });
            }
            if (creado.routes.length) await routes.destroy({ where: { id: creado.routes }, force: true });
            const [{ n }] = await sequelize.query(
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-F1A%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-F1A%')
                      + (SELECT count(*) FROM store_no_sale_reports WHERE comments LIKE 'PRUEBA-F1A%') AS n`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${n} filas de prueba (debe ser 0).`);
        } catch (e) { console.error('LIMPIEZA FALLIDA: ' + e.message); }
        await sequelize.close();
        console.log(`\n═══ ${ok} OK · ${fail} FALLAS ═══`);
        process.exit(fail ? 1 : 0);
    }
})();
