require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * 🧭 TIENDA DE LA RUTA SIN PARADA — que el servidor diga el motivo VERDADERO y el remedio exista.
 *
 * EL FALLO QUE ESTO CIERRA (15-sep-2026). Con la ruta ya iniciada se agregó una tienda. Al
 * marcarla, el servidor contestaba **"Primero debes iniciar la ruta"** — falso, ya estaba
 * iniciada. El vendedor buscó otra salida, encontró que la **venta ocasional** sí le creaba la
 * parada, y siguió por ahí: cinco ventas reales quedaron sin su parada y el Cuadre no cuadró por
 * 296.000. Diagnóstico completo en `OFFLINE-CAMPO.md` §16.
 *
 * LO QUE SE COMPRUEBA AQUÍ, y por qué va junto en una sola batería: son **dos endpoints que tienen
 * que contar la misma historia**. Marcar distingue tres situaciones con tres remedios distintos, la
 * venta ocasional cierra la puerta de atrás, y entre los dos tiene que quedar SIEMPRE un camino
 * transitable — el botón "Ajustar". Comprobar cada pieza por su lado dejaría fuera justo lo que
 * importa: que el vendedor que recibe el "no" pueda hacer algo con él.
 *
 * ⚠️ NO llega hasta la venta: eso exige bodega, productos y existencias, y lo cubren las baterías
 * de ventas. El ciclo completo hasta cobrar se prueba en el teléfono (paso S7 del plan).
 *
 * SEGURIDAD: monta su propio escenario (rutas y tiendas nuevas 'PRUEBA-SP ...'), no toca ninguna
 * fila existente y borra lo suyo al final, pase lo que pase.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const tiendasCtl = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const rutasCtl = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
const { stores, routes, store_visits, routes_stores, users, companies, sequelize } = models;

sequelize.options.logging = false;

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };
const titulo = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 72 - t.length))}`);

// res falso: captura status + body de la respuesta del controlador.
const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

(async () => {
    const creado = { stores: [], routes: [] };
    try {
        // ══ Escenario ═══════════════════════════════════════════════════════════════════
        const compania = await companies.findOne({ order: [['id', 'ASC']] });
        const companyId = compania.id;
        const tz = compania.timezone || 'America/Bogota';
        const [{ user_id: vendedor }] = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id = :cid AND status='active' LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } });
        const [{ hoy, ayer }] = await sequelize.query(
            `SELECT to_char((now() AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS hoy,
                    to_char((now() AT TIME ZONE :tz)::date - 1,'YYYY-MM-DD') AS ayer`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const u = await users.findByPk(vendedor, { attributes: ['first_name', 'last_name'] });
        const nombreVendedor = `${u.first_name} ${u.last_name}`.trim();
        const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

        const mkTienda = async (etiqueta) => {
            const t = await stores.create({
                name: `PRUEBA-SP ${etiqueta}`, company_id: companyId, address: 'Calle falsa 123',
                store_type_id: 1, latitude: 1.2136, longitude: -77.2811,
            });
            creado.stores.push(t.id);
            return t;
        };
        const mkRuta = async (etiqueta) => {
            const r = await routes.create({
                name: `PRUEBA-SP ${etiqueta}`, company_id: companyId, user_id: vendedor, working_days: DIAS,
            });
            creado.routes.push(r.id);
            return r;
        };
        const vincular = (ruta, tienda) =>
            routes_stores.create({ route_id: ruta.id, store_id: tienda.id, company_id: companyId });

        // La ruta EN MARCHA: T1 tiene parada (eso es la jornada), T2 es miembro y se quedó sin
        // ella —la tienda que se agregó con la ruta ya andando—, T3 no es miembro de nada.
        // La ruta SIN INICIAR existe para comprobar que el mensaje de siempre sigue siendo el
        // correcto cuando de verdad hay que iniciar la ruta.
        const ruta = await mkRuta('Ruta en marcha');
        const rutaSinIniciar = await mkRuta('Ruta sin iniciar');
        const [t0, t1, t2, t3] = await Promise.all(
            ['T0 sin jornada', 'T1 con parada', 'T2 miembro sin parada', 'T3 ajena'].map(mkTienda));
        await Promise.all([vincular(rutaSinIniciar, t0), vincular(ruta, t1), vincular(ruta, t2)]);

        const p1 = await store_visits.create({
            store_id: t1.id, route_id: ruta.id, route_name: ruta.name, user_id: vendedor,
            user_name: nombreVendedor, visit_day: hoy, store_name: t1.name, store_address: t1.address,
            status: 'pending', sale_amount: 0, date: sequelize.literal('now()'), visit_type: 'in-route',
        });

        // El vendedor es el ENCARGADO de la ruta: sin `userType: 'owner'` ni permisos especiales,
        // que es justo lo que hay que probar (el caso normal del que está en la calle).
        const usuario = { id: vendedor, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [] };

        const marcar = async ({ storeId, routeId, visitId, visitDay, distance = 10 }) => {
            const res = resFalso();
            await tiendasCtl.updateStoreAsVisited({
                params: { store_id: String(storeId) },
                body: {
                    distance,
                    ...(routeId ? { route_id: routeId } : {}),
                    ...(visitId ? { visit_id: visitId } : {}),
                    ...(visitDay ? { visit_day: visitDay } : {}),
                },
                user: usuario,
            }, res);
            return res;
        };
        const ventaOcasional = async (routeId, storeId) => {
            const res = resFalso();
            await rutasCtl.createOccasionalVisit(
                { params: { route_id: String(routeId) }, body: { store_id: storeId }, user: usuario }, res);
            return res;
        };
        const tarjetas = async (routeId) => {
            const res = resFalso();
            await tiendasCtl.getStoresbyRoute(
                { params: { route_id: String(routeId) }, body: {}, user: usuario }, res);
            return res.body?.stores || [];
        };
        const dime = (r) => `${r.statusCode} ${r.body?.code} — "${r.body?.message}"`;

        console.log(`\nRuta ${ruta.id} con jornada de ${hoy} (parada ${p1.id}) · sin iniciar ${rutaSinIniciar.id}`);

        // ══ A) MARCAR: tres situaciones, tres remedios ══════════════════════════════════
        titulo('A) Marcar una tienda sin parada');

        const a1 = await marcar({ storeId: t0.id, routeId: rutaSinIniciar.id });
        assert(a1.statusCode === 409 && a1.body.code === 'VISITA_NO_EXISTE'
            && /Primero debes iniciar la ruta/.test(a1.body.message),
            `ruta SIN jornada → el mensaje de siempre, que ahí sí es cierto → ${dime(a1)}`);

        // 🔴 EL CASO DEL 15-SEP. Antes contestaba "Primero debes iniciar la ruta" con la ruta
        // iniciada, y ese consejo imposible fue el origen de todo.
        const a2 = await marcar({ storeId: t2.id, routeId: ruta.id });
        assert(a2.statusCode === 409 && a2.body.code === 'SIN_PARADA',
            `ruta iniciada + tienda DE LA RUTA → SIN_PARADA → ${dime(a2)}`);
        assert(/Ajustar/.test(a2.body.message) && !/iniciar la ruta/.test(a2.body.message),
            'y el mensaje remite a "Ajustar", sin repetir el consejo falso');

        const a3 = await marcar({ storeId: t3.id, routeId: ruta.id });
        assert(a3.statusCode === 409 && a3.body.code === 'VISITA_NO_EXISTE'
            && /ya no pertenece/.test(a3.body.message),
            `ruta iniciada + tienda AJENA → "recarga la ruta" → ${dime(a3)}`);

        // Un cliente viejo (una pestaña con el JS de antes) no manda `route_id`. Sin él no se
        // puede nombrar la ruta, pero la membresía sigue contestando lo mismo.
        const a4 = await marcar({ storeId: t2.id });
        assert(a4.statusCode === 409 && a4.body.code === 'SIN_PARADA',
            `sin route_id, tienda de una ruta con jornada → SIN_PARADA → ${dime(a4)}`);

        const a5 = await marcar({ storeId: t3.id });
        assert(a5.statusCode === 409 && a5.body.code === 'VISITA_NO_EXISTE'
            && /Primero debes iniciar la ruta/.test(a5.body.message),
            `sin route_id y sin ninguna jornada → el mensaje de siempre → ${dime(a5)}`);

        // 🔴 DIFERIDO: la cola se vacía a la mañana siguiente. "Ajustar" solo toca de hoy en
        // adelante, así que mandar allí a alguien con trabajo de AYER sería mandarlo a un sitio
        // donde su tienda no está. Por eso ese día NO recibe SIN_PARADA (§16.5).
        const a6 = await marcar({ storeId: t2.id, routeId: ruta.id, visitDay: ayer });
        assert(a6.statusCode === 409 && a6.body.code === 'VISITA_NO_EXISTE' && a6.body.message.includes(ayer),
            `un marcado de AYER no se manda a "Ajustar" → ${dime(a6)}`);

        // ══ B) La tarjeta cuenta lo mismo que el servidor ═══════════════════════════════
        titulo('B) La tarjeta y el servidor dicen lo mismo');

        // Si estas dos definiciones se separan, el teléfono ofrece "Marcar" en una tienda que el
        // servidor va a rechazar — que es exactamente como empezó todo.
        const antes = await tarjetas(ruta.id);
        assert(antes.find((s) => s.id === t2.id)?.current_visit_status === 'sin_parada',
            'la tarjeta de la tienda sin parada dice `sin_parada`, igual que el 409');
        assert(antes.find((s) => s.id === t1.id)?.current_visit_status === 'pending',
            'y la que sí tiene parada sigue `pending`');

        // ══ C) La puerta de atrás: la venta ocasional ═══════════════════════════════════
        titulo('C) La venta ocasional ya no acepta tiendas de la ruta');

        const c1 = await ventaOcasional(ruta.id, t2.id);
        assert(c1.statusCode === 409 && c1.body.code === 'SIN_PARADA',
            `tienda DE LA RUTA → el MISMO código que al marcar → ${dime(c1)}`);
        assert(/Ajustar/.test(c1.body.message || ''), 'y también remite a "Ajustar"');
        const coladas = await store_visits.count({ where: { route_id: ruta.id, store_id: t2.id, visit_day: hoy } });
        assert(coladas === 0, 'no se le creó la parada por la puerta de atrás (era el fallo del 15-sep)');

        const c2 = await ventaOcasional(ruta.id, t3.id);
        assert(c2.statusCode === 201 && c2.body?.visita?.visit_type === 'occasional',
            `tienda AJENA → sigue siendo una venta ocasional legítima → ${dime(c2)}`);

        const c3 = await ventaOcasional(ruta.id, t3.id);
        assert(c3.statusCode === 200 && c3.body?.ya_existia === true,
            'pulsar dos veces devuelve la parada que ya hay, no duplica');

        // ══ D) El ciclo completo: el "no" tiene salida ══════════════════════════════════
        titulo('D) Rechazo → Ajustar → marcar');

        // 🔑 LO QUE HACE LEGÍTIMO CERRAR LA PUERTA. A la venta ocasional solo llega el encargado
        // ACTUAL de la ruta, y el diagnóstico de ajuste toma como responsable de la jornada a ese
        // mismo encargado actual, así que SIEMPRE puede ajustar. Si alguna de las dos reglas
        // cambia, esto se pone rojo — que es justo para lo que está.
        const resDiag = resFalso();
        await rutasCtl.getRouteAdjustments({ params: { route_id: String(ruta.id) }, user: usuario }, resDiag);
        const faltantes = (resDiag.body?.jornadas || []).flatMap((j) => j.faltantes || []);
        assert(faltantes.some((f) => f.store_id === t2.id),
            'el MISMO usuario que recibió el "no" ve la tienda entre los ajustes pendientes');

        const resAplicar = resFalso();
        await rutasCtl.applyRouteAdjustments({
            params: { route_id: String(ruta.id) },
            body: { agregar: [{ visit_day: hoy, store_id: t2.id }] },
            user: usuario,
        }, resAplicar);
        assert((resAplicar.body?.agregadas || []).length === 1,
            `y puede aplicarlo (${JSON.stringify(resAplicar.body?.omitidas || [])})`);

        const paradaNueva = await store_visits.findOne({ where: { route_id: ruta.id, store_id: t2.id, visit_day: hoy } });
        assert(paradaNueva && paradaNueva.status === 'pending',
            'la parada nace PENDIENTE: primero se marca la visita, después se vende');
        // `in-route`, no `occasional`: es una parada normal de la ruta. Si naciera ocasional,
        // "Ajustar" no volvería a mirarla nunca y el dato mentiría sobre de dónde salió.
        assert(paradaNueva.visit_type === 'in-route', 'y como parada NORMAL de la ruta, no como ocasional');

        const despues = await tarjetas(ruta.id);
        const tarjeta = despues.find((s) => s.id === t2.id);
        assert(tarjeta?.current_visit_status === 'pending' && tarjeta?.current_visit_id === paradaNueva.id,
            'la tarjeta deja de decir `sin_parada` y ya lleva el id de la parada');

        const d = await marcar({ storeId: t2.id, routeId: ruta.id });
        assert(d.statusCode === 200, `y el MISMO marcado que fue rechazado ahora sale bien → ${dime(d)}`);
        assert((await store_visits.findByPk(paradaNueva.id)).status === 'visited',
            'la parada queda VISITADA, lista para la venta o el reporte de no compra');

    } catch (e) {
        console.error('\nERROR:', e.message, e.stack);
        fail++;
    } finally {
        // Limpieza: solo lo creado por esta prueba.
        try {
            if (creado.stores.length) {
                await store_visits.destroy({ where: { store_id: creado.stores } });
                await routes_stores.destroy({ where: { store_id: creado.stores } });
                await stores.destroy({ where: { id: creado.stores }, force: true });
            }
            if (creado.routes.length) await routes.destroy({ where: { id: creado.routes }, force: true });
            const [{ n }] = await sequelize.query(
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-SP%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-SP%') AS n`,
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
