require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * El resumen de jornada que alimenta el anillo de progreso de ShowRoute.
 *
 * Lo que se comprueba es el caso que lo motivo: una parada OCASIONAL no esta en la membresia
 * de la ruta, asi que contando tarjetas el anillo decia "N/N, 100%" con una parada sin hacer.
 *
 * SEGURIDAD: crea SUS PROPIAS rutas/tiendas ('PRUEBA-ANILLO ...') y las borra al terminar
 * pase lo que pase. No toca ninguna jornada real.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const rutas = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
const tiendasCtl = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const { stores, routes, store_visits, routes_stores, companies, sequelize } = models;
const { construirParada } = require(path.join(SERVER, 'src', 'utils', 'storeVisits.js'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

// Reproduce EXACTAMENTE lo que hace el memo `routeProgress` de ShowRoute en su rama 2
// (tarjetas vivas + delta de ocasionales del servidor).
const anilloDesdeTarjetas = (payload) => {
    const s = payload.stores || [];
    const j = payload.jornada;
    if (!j || !j.iniciada) return { iniciada: false, completed: 0, total: s.length, percentage: 0 };
    const conParada = s.filter((x) => x.current_visit_status !== 'sin_parada');
    const total = conParada.length + j.ocasionales.total;
    const completed = conParada.filter((x) => x.current_visit_status === 'completed').length
        + j.ocasionales.completadas;
    return { iniciada: true, completed, total, percentage: total ? Math.round(completed / total * 100) : 0 };
};

// El calculo ANTERIOR (solo tarjetas), para demostrar el fallo que se corrige.
const anilloViejo = (payload) => {
    const enJornada = (payload.stores || []).filter((x) => x.current_visit_status !== 'sin_parada');
    const completed = enJornada.filter((x) => x.current_visit_status === 'completed').length;
    return { completed, total: enJornada.length, percentage: enJornada.length ? Math.round(completed / enJornada.length * 100) : 0 };
};

(async () => {
    const creado = { stores: [], routes: [] };
    try {
        const compania = await companies.findOne({ order: [['id', 'ASC']] });
        const companyId = compania.id;
        const tz = compania.timezone || 'America/Bogota';

        const [{ user_id: vendedor }] = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id = :cid AND status='active' LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } });

        const [{ d: hoy }] = await sequelize.query(`SELECT (now() AT TIME ZONE :tz)::date AS d`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const ruta = await routes.create({
            name: 'PRUEBA-ANILLO Ruta', company_id: companyId, user_id: vendedor,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(ruta.id);

        const mk = (n) => stores.create({
            name: `PRUEBA-ANILLO ${n}`, company_id: companyId, address: `Calle ${n}`, store_type_id: 1,
            ubicacion: sequelize.fn('ST_SetSRID', sequelize.fn('ST_MakePoint', -77.2811, 1.2136), 4326),
        });
        const m1 = await mk('Miembro 1');
        const m2 = await mk('Miembro 2');
        const ajena = await mk('Ajena (ocasional)');
        creado.stores.push(m1.id, m2.id, ajena.id);
        await routes_stores.bulkCreate([
            { route_id: ruta.id, store_id: m1.id, company_id: companyId },
            { route_id: ruta.id, store_id: m2.id, company_id: companyId },
        ]);

        const usuario = { id: vendedor, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [] };
        const pedirTiendas = async () => {
            const res = resFalso();
            await tiendasCtl.getStoresbyRoute({ params: { route_id: String(ruta.id) }, user: usuario }, res);
            return res.body;
        };

        console.log(`\nRuta ${ruta.id} · 2 miembros + 1 tienda ajena · dia ${hoy}\n`);

        // ── 1) SIN jornada ────────────────────────────────────────────────────
        console.log('-- Ruta NO iniciada --');
        let p = await pedirTiendas();
        assert(p.jornada !== undefined, 'la respuesta trae el bloque `jornada`');
        assert(p.jornada.iniciada === false, 'iniciada = false');
        assert(p.jornada.total === 0, 'no hay paradas');
        let anillo = anilloDesdeTarjetas(p);
        assert(anillo.iniciada === false && anillo.total === 2 && anillo.completed === 0,
            `el anillo muestra las tiendas de la ruta: ${anillo.total} (y no habla de progreso)`);

        // ── 2) Jornada iniciada con los 2 miembros ────────────────────────────
        console.log('\n-- Jornada iniciada (2 paradas) --');
        for (const st of [m1, m2]) {
            await store_visits.create(construirParada({
                store: st, route: ruta, userId: vendedor, userName: 'Vendedor',
                visitDay: hoy, fechaMarca: new Date(),
            }));
        }
        p = await pedirTiendas();
        assert(p.jornada.iniciada === true && p.jornada.total === 2, 'iniciada = true, 2 paradas');
        anillo = anilloDesdeTarjetas(p);
        assert(anillo.total === 2 && anillo.completed === 0 && anillo.percentage === 0, 'anillo 0/2 · 0 %');

        // ── 3) Se completan las 2 del dia → 100 % legitimo ────────────────────
        await store_visits.update({ status: 'completed' }, { where: { route_id: ruta.id, visit_day: hoy } });
        p = await pedirTiendas();
        anillo = anilloDesdeTarjetas(p);
        assert(anillo.percentage === 100, 'con todo hecho, 100 % (2/2)');

        // ── 4) EL CASO QUE LO MOTIVO: se agrega una venta ocasional ───────────
        console.log('\n-- Se agrega una parada OCASIONAL (queda pendiente) --');
        const resVO = resFalso();
        await rutas.createOccasionalVisit(
            { params: { route_id: String(ruta.id) }, body: { store_id: ajena.id }, user: usuario }, resVO);
        assert(resVO.statusCode === 201, 'la parada ocasional se crea');

        p = await pedirTiendas();
        assert(p.stores.length === 2, 'las TARJETAS siguen siendo 2: la ocasional NO es miembro de la ruta');
        assert(p.jornada.total === 3, 'pero la jornada ya tiene 3 paradas');
        assert(p.jornada.ocasionales.total === 1 && p.jornada.ocasionales.completadas === 0,
            'el servidor informa el delta: 1 ocasional, 0 completada');

        const viejo = anilloViejo(p);
        assert(viejo.percentage === 100,
            `el calculo ANTERIOR dice ${viejo.completed}/${viejo.total} = ${viejo.percentage} % (el fallo)`);

        anillo = anilloDesdeTarjetas(p);
        assert(anillo.total === 3 && anillo.completed === 2 && anillo.percentage === 67,
            `el nuevo dice ${anillo.completed}/${anillo.total} = ${anillo.percentage} % (correcto)`);

        // ── 5) Se completa la ocasional → 100 % de verdad ─────────────────────
        await store_visits.update({ status: 'completed' },
            { where: { route_id: ruta.id, store_id: ajena.id, visit_day: hoy } });
        p = await pedirTiendas();
        assert(p.jornada.ocasionales.completadas === 1, 'el delta refleja la ocasional completada');
        anillo = anilloDesdeTarjetas(p);
        assert(anillo.completed === 3 && anillo.total === 3 && anillo.percentage === 100,
            'ahora si: 3/3 = 100 %');

        // ── 6) Miembro SIN parada (vinculado despues de iniciar) ──────────────
        console.log('\n-- Tienda vinculada DESPUES de iniciar (sin parada) --');
        const tarde = await mk('Vinculada tarde');
        creado.stores.push(tarde.id);
        await routes_stores.create({ route_id: ruta.id, store_id: tarde.id, company_id: companyId });
        p = await pedirTiendas();
        const sinParada = p.stores.filter((x) => x.current_visit_status === 'sin_parada');
        assert(sinParada.length === 1, 'la tienda nueva se proyecta como `sin_parada`');
        anillo = anilloDesdeTarjetas(p);
        assert(anillo.total === 3 && anillo.percentage === 100,
            'NO entra en el denominador: sigue 3/3 = 100 % (si entrara, nunca se llegaria al 100 %)');

        // ── 7) La fuente 1 (cajon) da lo mismo que la fuente 2 ────────────────
        console.log('\n-- Coherencia entre las dos fuentes --');
        const resCajon = resFalso();
        await rutas.getRouteDayVisits({ params: { route_id: String(ruta.id) }, query: {}, user: usuario }, resCajon);
        const cajon = resCajon.body?.data ?? resCajon.body;
        const desdeCajon = {
            total: cajon.visitas.length,
            completed: cajon.visitas.filter((v) => v.status === 'completed').length,
        };
        assert(desdeCajon.total === anillo.total && desdeCajon.completed === anillo.completed,
            `el cajon da ${desdeCajon.completed}/${desdeCajon.total} y las tarjetas+delta ${anillo.completed}/${anillo.total}: coinciden`);
        assert(cajon.resumen.total === p.jornada.total && cajon.resumen.completed === p.jornada.completadas,
            'y los dos resumenes del backend tambien coinciden entre si');

    } catch (e) {
        console.error('\nERROR:', e.message);
        fail++;
    } finally {
        try {
            if (creado.stores.length) {
                await store_visits.destroy({ where: { store_id: creado.stores } });
                await routes_stores.destroy({ where: { store_id: creado.stores } });
                await stores.destroy({ where: { id: creado.stores }, force: true });
            }
            if (creado.routes.length) await routes.destroy({ where: { id: creado.routes }, force: true });
            const [{ n }] = await sequelize.query(
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-ANILLO%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-ANILLO%') AS n`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${n} filas de prueba (debe ser 0).`);
        } catch (e) { console.error('LIMPIEZA FALLIDA:', e.message); }
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
