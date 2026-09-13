require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Regla única: OPERAR una ruta = ser su ENCARGADO ACTUAL.
 * Ni owner ni `start_route_for_others` pueden optimizar ni crear venta ocasional.
 *
 * SEGURIDAD: crea SUS PROPIAS rutas/tiendas ('PRUEBA-ENC ...') y las borra al terminar
 * pase lo que pase. No toca ninguna jornada real.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const rutas = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
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

const usr = (id, companyId, tz, extra = {}) => ({
    id, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [], ...extra,
});

const ocasional = async (routeId, storeId, user) => {
    const res = resFalso();
    await rutas.createOccasionalVisit({ params: { route_id: String(routeId) }, body: { store_id: storeId }, user }, res);
    return res;
};
const optimizar = async (routeId, user) => {
    const res = resFalso();
    await rutas.optimizeRoute({
        params: { route_id: String(routeId) },
        query: { lat: '1.2136', lng: '-77.2811' },
        body: {}, user,
    }, res);
    return res;
};

(async () => {
    const creado = { stores: [], routes: [] };
    try {
        const compania = await companies.findOne({ order: [['id', 'ASC']] });
        const companyId = compania.id;
        const tz = compania.timezone || 'America/Bogota';

        const miembros = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id = :cid AND status='active' LIMIT 2`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } });
        if (miembros.length < 2) throw new Error('Se necesitan 2 miembros activos para esta prueba');
        const encargado = miembros[0].user_id;
        const otro = miembros[1].user_id;

        const [{ d: hoy }] = await sequelize.query(`SELECT (now() AT TIME ZONE :tz)::date AS d`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const ruta = await routes.create({
            name: 'PRUEBA-ENC Ruta', company_id: companyId, user_id: encargado,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(ruta.id);

        const mk = (n) => stores.create({
            name: `PRUEBA-ENC ${n}`, company_id: companyId, address: `Calle ${n}`, store_type_id: 1,
            ubicacion: sequelize.fn('ST_SetSRID', sequelize.fn('ST_MakePoint', -77.2811, 1.2136), 4326),
        });
        const miembro = await mk('Miembro');
        const ajena = await mk('Ajena');
        creado.stores.push(miembro.id, ajena.id);
        await routes_stores.create({ route_id: ruta.id, store_id: miembro.id, company_id: companyId });

        // Jornada iniciada a nombre del encargado
        await store_visits.create(construirParada({
            store: miembro, route: ruta, userId: encargado, userName: 'Encargado',
            visitDay: hoy, fechaMarca: new Date(),
        }));

        console.log(`\nRuta ${ruta.id} · encargado ${encargado}\n`);

        console.log('-- VENTA OCASIONAL --');
        const rOwner = await ocasional(ruta.id, ajena.id, usr(otro, companyId, tz, { userType: 'owner' }));
        assert(rOwner.statusCode === 403, `el OWNER ya NO puede crearla -> 403 ("${rOwner.body?.message}")`);
        assert(/as[ií]gnate la ruta/i.test(rOwner.body?.message || ''), 'el 403 dice que hacer: asignarse la ruta');

        const rSup = await ocasional(ruta.id, ajena.id, usr(otro, companyId, tz, { permissions: ['start_route_for_others'] }));
        assert(rSup.statusCode === 403, `con start_route_for_others tampoco -> 403 ("${rSup.body?.message}")`);

        const rAjeno = await ocasional(ruta.id, ajena.id, usr(otro, companyId, tz));
        assert(rAjeno.statusCode === 403, 'un colaborador cualquiera tampoco -> 403');

        const rEnc = await ocasional(ruta.id, ajena.id, usr(encargado, companyId, tz));
        assert(rEnc.statusCode === 201, `el ENCARGADO si puede -> 201 ("${rEnc.body?.message}")`);
        assert(rEnc.body?.visita?.visit_type === 'occasional', 'y nace como ocasional');

        const enBD = await store_visits.findByPk(rEnc.body.visita.visit_id);
        assert(enBD.user_id === encargado, 'la parada queda a nombre del encargado');

        const nOcasionales = await store_visits.count({ where: { route_id: ruta.id, store_id: ajena.id, visit_day: hoy } });
        assert(nOcasionales === 1, `los 3 rechazos NO dejaron basura: hay ${nOcasionales} parada(s)`);

        console.log('\n-- OPTIMIZAR --');
        const oOwner = await optimizar(ruta.id, usr(otro, companyId, tz, { userType: 'owner' }));
        assert(oOwner.statusCode === 403, `el OWNER no puede optimizar -> 403 ("${oOwner.body?.message}")`);
        const oSup = await optimizar(ruta.id, usr(otro, companyId, tz, { permissions: ['start_route_for_others'] }));
        assert(oSup.statusCode === 403, 'con start_route_for_others tampoco -> 403');
        const oEnc = await optimizar(ruta.id, usr(encargado, companyId, tz));
        assert(oEnc.statusCode === 200, `el ENCARGADO si -> ${oEnc.statusCode} ("${oEnc.body?.message}")`);

        console.log('\n-- RUTA SIN ENCARGADO: no la opera nadie --');
        await ruta.update({ user_id: null });
        const sOwner = await ocasional(ruta.id, ajena.id, usr(otro, companyId, tz, { userType: 'owner' }));
        assert(sOwner.statusCode === 403 && /no tiene un encargado/i.test(sOwner.body?.message || ''),
            `sin encargado, ni el owner -> 403 ("${sOwner.body?.message}")`);

        console.log('\n-- VER sigue permitido para el owner (no se rompio la consulta) --');
        await ruta.update({ user_id: encargado });
        const resVer = resFalso();
        await rutas.getRouteDayVisits({
            params: { route_id: String(ruta.id) }, query: {},
            user: usr(otro, companyId, tz, { userType: 'owner' })
        }, resVer);
        const ver = resVer.body?.data ?? resVer.body;
        assert(resVer.statusCode === 200, 'el owner SIGUE pudiendo ver la jornada de otro -> 200');
        assert(ver?.es_mi_lista === false, 'y la recibe marcada como NO suya (el cajon la pone en solo lectura)');
        assert((ver?.visitas || []).length >= 2, `y con sus paradas (${(ver?.visitas || []).length})`);

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
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-ENC%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-ENC%') AS n`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${n} filas de prueba (debe ser 0).`);
        } catch (e) { console.error('LIMPIEZA FALLIDA:', e.message); }
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
