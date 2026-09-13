require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Ruta SIN vendedor asignado: se ve y se le administran tiendas, pero NO se inicia,
 * NO se opera y NO se optimiza. Ni siquiera el owner.
 *
 * SEGURIDAD: crea SUS PROPIAS rutas/tiendas ('PRUEBA-SINENC ...') y las borra al terminar
 * pase lo que pase. No toca ninguna jornada real.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const rutas = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
const tiendasCtl = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const { stores, routes, store_visits, routes_stores, companies, sequelize } = models;

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
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
        const uno = miembros[0].user_id;
        const dos = (miembros[1] || miembros[0]).user_id;

        // Ruta SIN user_id
        const ruta = await routes.create({
            name: 'PRUEBA-SINENC Ruta huerfana', company_id: companyId, user_id: null,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(ruta.id);

        const mk = (n) => stores.create({
            name: `PRUEBA-SINENC ${n}`, company_id: companyId, address: `Calle ${n}`, store_type_id: 1,
            ubicacion: sequelize.fn('ST_SetSRID', sequelize.fn('ST_MakePoint', -77.2811, 1.2136), 4326),
        });
        const t1 = await mk('Tienda 1');
        const t2 = await mk('Tienda 2');
        creado.stores.push(t1.id, t2.id);
        await routes_stores.create({ route_id: ruta.id, store_id: t1.id, company_id: companyId });

        const owner = { id: dos, companyId, companyTimezone: tz, userType: 'owner', permissions: [] };
        const supervisor = { id: dos, companyId, companyTimezone: tz, userType: 'collaborator', permissions: ['start_route_for_others'] };
        const colaborador = { id: uno, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [] };

        console.log(`\nRuta ${ruta.id} SIN vendedor asignado · 1 tienda vinculada\n`);

        // ── LO QUE SÍ SE PUEDE ────────────────────────────────────────────────
        console.log('-- SI se puede: ver la ruta y sus tiendas --');
        for (const [quien, user] of [['owner', owner], ['colaborador', colaborador]]) {
            const res = resFalso();
            await tiendasCtl.getStoresbyRoute({ params: { route_id: String(ruta.id) }, user }, res);
            assert(res.statusCode === 200 && res.body.stores.length === 1,
                `${quien}: abre ShowRoute y ve las tiendas de la ruta (${res.body?.stores?.length})`);
            if (quien === 'owner') {
                assert(res.body.jornada.iniciada === false,
                    'el anillo la reporta SIN iniciar (no hay jornada que medir)');
            }
        }

        console.log('\n-- SI se puede: vincular y desvincular tiendas --');
        const resLink = resFalso();
        await tiendasCtl.assignStoreToRoute(
            { params: { storeId: String(t2.id) }, body: { route_id: ruta.id }, user: owner }, resLink);
        assert(resLink.statusCode === 200 || resLink.statusCode === 201,
            `agregar una tienda a la ruta -> ${resLink.statusCode} ("${resLink.body?.message}")`);
        assert(await routes_stores.count({ where: { route_id: ruta.id } }) === 2, 'la ruta pasa a tener 2 tiendas');

        const resUnlink = resFalso();
        await tiendasCtl.removeStoreFromRoute(
            { params: { storeId: String(t2.id), routeId: String(ruta.id) }, body: {}, user: owner }, resUnlink);
        assert(resUnlink.statusCode === 200, `quitar la tienda de la ruta -> 200 ("${resUnlink.body?.message}")`);
        assert(await routes_stores.count({ where: { route_id: ruta.id } }) === 1, 'vuelve a tener 1');

        console.log('\n-- SI se puede: consultar el cajon (es donde se explica el problema) --');
        for (const [quien, user] of [['owner', owner], ['colaborador', colaborador]]) {
            const res = resFalso();
            await rutas.getRouteDayVisits({ params: { route_id: String(ruta.id) }, query: {}, user }, res);
            const d = res.body?.data ?? res.body;
            assert(res.statusCode === 200, `${quien}: consulta el cajon -> 200 (sin permiso especial)`);
            assert(d?.es_mi_lista === false, `${quien}: es_mi_lista = false -> el cajon queda en SOLO LECTURA`);
            assert(d?.user_id === null, `${quien}: user_id = null (la jornada no es de nadie)`);
            assert(d?.responsable === null, `${quien}: sin responsable -> el boton Iniciar sale bloqueado con el motivo`);
        }

        // ── LO QUE NO SE PUEDE ────────────────────────────────────────────────
        console.log('\n-- NO se puede: INICIAR (ni el owner, ni con start_route_for_others) --');
        for (const [quien, user] of [['owner', owner], ['supervisor', supervisor], ['colaborador', colaborador]]) {
            const res = resFalso();
            await rutas.startRoute({ params: { route_id: String(ruta.id) }, body: {}, user }, res);
            assert(res.statusCode === 400 && /no tiene un vendedor asignado/i.test(res.body?.message || ''),
                `${quien}: iniciar -> 400 ("${res.body?.message}")`);
        }
        assert(await store_visits.count({ where: { route_id: ruta.id } }) === 0,
            'no se cre\u00f3 NINGUNA parada en los tres intentos');

        console.log('\n-- NO se puede: OPTIMIZAR --');
        for (const [quien, user] of [['owner', owner], ['supervisor', supervisor]]) {
            const res = resFalso();
            await rutas.optimizeRoute({
                params: { route_id: String(ruta.id) }, query: { lat: '1.2136', lng: '-77.2811' }, body: {}, user,
            }, res);
            assert(res.statusCode === 403 && /no tiene un encargado/i.test(res.body?.message || ''),
                `${quien}: optimizar -> 403 ("${res.body?.message}")`);
        }

        console.log('\n-- NO se puede: VENTA OCASIONAL --');
        for (const [quien, user] of [['owner', owner], ['supervisor', supervisor]]) {
            const res = resFalso();
            await rutas.createOccasionalVisit(
                { params: { route_id: String(ruta.id) }, body: { store_id: t1.id }, user }, res);
            assert(res.statusCode === 403 && /no tiene un encargado/i.test(res.body?.message || ''),
                `${quien}: venta ocasional -> 403 con el motivo REAL ("${res.body?.message}")`);
        }

        console.log('\n-- NO se puede: MARCAR una visita --');
        // Se fabrica una parada a mano (el flujo normal no la deja crear) para comprobar que,
        // aun existiendo, marcarla se rechaza porque la ruta no tiene encargado.
        const parada = await store_visits.create({
            user_id: uno, store_id: t1.id, route_id: ruta.id, visit_day: (await sequelize.query(
                `SELECT (now() AT TIME ZONE :tz)::date AS d`,
                { type: sequelize.QueryTypes.SELECT, replacements: { tz } }))[0].d,
            date: new Date(), status: 'pending', store_name: t1.name, route_name: ruta.name,
        });
        for (const [quien, user] of [['owner', owner], ['colaborador', colaborador]]) {
            const res = resFalso();
            await tiendasCtl.updateStoreAsVisited({
                params: { store_id: String(t1.id) }, body: { distance: 10, visit_id: parada.id }, user,
            }, res);
            assert(res.statusCode === 403 && /no tiene un encargado/i.test(res.body?.message || ''),
                `${quien}: marcar -> 403 ("${res.body?.message}")`);
        }
        const sigue = await store_visits.findByPk(parada.id);
        assert(sigue.status === 'pending', 'la parada sigue PENDIENTE: ningun intento la movio');

        console.log('\n-- Y al asignarle un vendedor, todo se desbloquea --');
        await ruta.update({ user_id: uno });
        const resOk = resFalso();
        await tiendasCtl.updateStoreAsVisited({
            params: { store_id: String(t1.id) }, body: { distance: 10, visit_id: parada.id },
            user: colaborador,
        }, resOk);
        assert(resOk.statusCode === 200, `el nuevo encargado ya puede marcar -> 200 ("${resOk.body?.message}")`);
        const resVer = resFalso();
        await rutas.getRouteDayVisits({ params: { route_id: String(ruta.id) }, query: {}, user: colaborador }, resVer);
        const dv = resVer.body?.data ?? resVer.body;
        assert(dv?.es_mi_lista === true && dv?.user_id === uno, 'y el cajon pasa a ser operable para el');

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
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-SINENC%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-SINENC%') AS n`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${n} filas de prueba (debe ser 0).`);
        } catch (e) { console.error('LIMPIEZA FALLIDA:', e.message); }
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
