require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Paso 1 de la venta ocasional: crear la parada pendiente.
 *
 * Llama al controlador REAL (`createOccasionalVisit`) con req/res falsos.
 *
 * SEGURIDAD: crea SUS PROPIAS rutas y tiendas ('PRUEBA-VO ...'), nunca toca las jornadas
 * reales que el usuario tenga hoy en dev, y borra todo lo suyo al terminar pase lo que pase.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const rutas = require(path.join(SERVER, 'src', 'controllers', 'routes_controller.js'));
const tiendasCtl = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const { stores, routes, store_visits, routes_stores, users, companies, sequelize } = models;
const { construirParada } = require(path.join(SERVER, 'src', 'utils', 'storeVisits.js'));

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const agregar = async ({ routeId, storeId, user }) => {
    const res = resFalso();
    await rutas.createOccasionalVisit({ params: { route_id: String(routeId) }, body: { store_id: storeId }, user }, res);
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
        const vendedor = miembros[0].user_id;
        const ajeno = (miembros[1] || miembros[0]).user_id;

        const [{ d: hoy }] = await sequelize.query(`SELECT (now() AT TIME ZONE :tz)::date AS d`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });

        const u = await users.findByPk(vendedor, { attributes: ['first_name', 'last_name'] });
        const nombreVendedor = `${u.first_name} ${u.last_name}`.trim();

        // Escenario: ruta NORTE (con 1 tienda propia) + una tienda del SUR que NO le pertenece.
        const norte = await routes.create({
            name: 'PRUEBA-VO Ruta Norte', company_id: companyId, user_id: vendedor,
            working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        });
        creado.routes.push(norte.id);

        const mk = (n) => stores.create({
            name: `PRUEBA-VO ${n}`, company_id: companyId, address: `Calle ${n}`,
            store_type_id: 1,
            // El modelo guarda las coordenadas en PostGIS (`ubicacion`); `latitude`/`longitude`
            // son solo getters, pasarlos a create() no escribe nada.
            ubicacion: sequelize.fn('ST_SetSRID', sequelize.fn('ST_MakePoint', -77.2811, 1.2136), 4326),
        });
        const tiendaNorte = await mk('Tienda del Norte');
        const tiendaSur = await mk('Tienda del Sur');
        const tiendaSinParada = await mk('Miembro sin parada');
        creado.stores.push(tiendaNorte.id, tiendaSur.id, tiendaSinParada.id);

        // La del norte y la "miembro sin parada" pertenecen a la ruta; la del sur NO.
        await routes_stores.bulkCreate([
            { route_id: norte.id, store_id: tiendaNorte.id, company_id: companyId },
            { route_id: norte.id, store_id: tiendaSinParada.id, company_id: companyId },
        ]);

        const usuario = { id: vendedor, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [] };
        console.log(`\nRuta ${norte.id} · tienda del sur ${tiendaSur.id} · día ${hoy}\n`);

        // ── 1) Sin jornada iniciada: no hay a qué agregar ─────────────────────
        const r1 = await agregar({ routeId: norte.id, storeId: tiendaSur.id, user: usuario });
        assert(r1.statusCode === 400 && /jornada iniciada/i.test(r1.body?.message || ''),
            `sin ruta iniciada → 400 ("${r1.body?.message}")`);

        // Se inicia la jornada (solo la tienda del norte).
        await store_visits.create(construirParada({
            store: tiendaNorte, route: norte, userId: vendedor, userName: nombreVendedor,
            visitDay: hoy, fechaMarca: new Date(),
        }));

        // ── 2) La venta ocasional ─────────────────────────────────────────────
        const r2 = await agregar({ routeId: norte.id, storeId: tiendaSur.id, user: usuario });
        assert(r2.statusCode === 201, `tienda ajena a la ruta → 201 ("${r2.body?.message}")`);
        assert(r2.body?.visita?.visit_type === 'occasional', 'la parada nace marcada como `occasional`');
        assert(r2.body?.visita?.status === 'pending', 'nace PENDIENTE, para marcarla y venderle después');

        const enBD = await store_visits.findByPk(r2.body.visita.visit_id);
        assert(enBD.route_id === norte.id, 'lleva el route_id de la ruta que se está corriendo');
        assert(String(enBD.visit_day) === String(hoy), 'queda en el día de hoy');
        assert(enBD.user_id === vendedor, 'queda a nombre del encargado de la ruta');
        assert(enBD.store_name === tiendaSur.name && enBD.route_name === norte.name,
            'congela el nombre de la tienda y de la ruta (snapshot)');

        const vinculada = await routes_stores.count({ where: { route_id: norte.id, store_id: tiendaSur.id } });
        assert(vinculada === 0, 'NO se vinculó la tienda a la ruta (la membresía es permanente)');

        // ── 3) Forma de la respuesta: la del cajón de visitas ─────────────────
        const campos = ['visit_id', 'store_id', 'store_name', 'store_address', 'status', 'arrived_at',
            'sale_amount', 'optimized_seq', 'visit_type', 'estado', 'abre_a'];
        assert(campos.every((c) => c in r2.body.visita),
            'devuelve la parada con la misma forma que las filas del cajón (se puede insertar sin recargar)');

        // ── 4) Idempotencia ───────────────────────────────────────────────────
        const r4 = await agregar({ routeId: norte.id, storeId: tiendaSur.id, user: usuario });
        assert(r4.statusCode === 200 && r4.body?.ya_existia === true, 'pulsar dos veces devuelve la existente, no duplica');
        const cuantas = await store_visits.count({ where: { route_id: norte.id, store_id: tiendaSur.id, visit_day: hoy } });
        assert(cuantas === 1, `sigue habiendo UNA sola parada de esa tienda (${cuantas})`);

        // ── 5) Tienda que SÍ es miembro → no se marca como ocasional ──────────
        const r5 = await agregar({ routeId: norte.id, storeId: tiendaSinParada.id, user: usuario });
        assert(r5.statusCode === 201 && r5.body?.visita?.visit_type === 'in-route',
            'una tienda que SÍ pertenece a la ruta se agrega como `in-route`, no como ocasional');

        // ── 6) Ajustar NO debe ofrecer borrar la ocasional ────────────────────
        const resAj = resFalso();
        await rutas.getRouteAdjustments({ params: { route_id: String(norte.id) }, user: usuario }, resAj);
        const diag = resAj.body?.data ?? resAj.body;
        const sobrantes = (diag?.jornadas || []).flatMap((j) => j.sobrantes || []);
        assert(!sobrantes.some((s) => s.store_id === tiendaSur.id),
            `el diagnóstico de Ajustar NO la lista como sobrante (${sobrantes.length} sobrante(s) en total)`);

        // ── 7) Autorización ───────────────────────────────────────────────────
        if (ajeno !== vendedor) {
            const r7 = await agregar({
                routeId: norte.id, storeId: tiendaSur.id,
                user: { id: ajeno, companyId, companyTimezone: tz, userType: 'collaborator', permissions: [] },
            });
            assert(r7.statusCode === 403, `un colaborador ajeno a la jornada → 403 ("${r7.body?.message}")`);
        }

        // ── 8) Validaciones ───────────────────────────────────────────────────
        const r8 = await agregar({ routeId: norte.id, storeId: 999999999, user: usuario });
        assert(r8.statusCode === 404, 'tienda inexistente → 404');
        const r9 = await agregar({ routeId: 999999999, storeId: tiendaSur.id, user: usuario });
        assert(r9.statusCode === 404, 'ruta inexistente → 404');


        // -- 9) La parada ocasional SE VE en el cajon, con lo que el menu necesita --
        const resCajon = resFalso();
        await rutas.getRouteDayVisits(
            { params: { route_id: String(norte.id) }, query: {}, user: usuario }, resCajon);
        const cajon = resCajon.body?.data ?? resCajon.body;
        const fila = (cajon?.visitas || []).find((v) => v.store_id === tiendaSur.id);
        assert(!!fila, 'la parada ocasional aparece en el cajon de visitas del dia');
        assert(fila?.visit_type === 'occasional', 'el cajon la identifica como ocasional');
        assert(fila?.latitude !== null && fila?.longitude !== null,
            'la fila trae COORDENADAS (sin ellas el menu no abre ni se puede marcar)');
        assert(fila?.estado !== undefined, 'trae su estado por horario, como el resto');

        // -- 10) Se puede MARCAR desde ahi: es el flujo real del vendedor --
        const resMarcar = resFalso();
        await tiendasCtl.updateStoreAsVisited({
            params: { store_id: String(tiendaSur.id) },
            body: { distance: 10, visit_id: fila.visit_id },
            user: usuario,
        }, resMarcar);
        assert(resMarcar.statusCode === 200, 'marcar la parada ocasional -> 200 (' + resMarcar.body?.message + ')');
        const marcada = await store_visits.findByPk(fila.visit_id);
        assert(marcada.status === 'visited', 'queda VISITADA, lista para registrarle la venta');
        assert(marcada.visit_type === 'occasional', 'sigue siendo ocasional despues de marcarla');

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
                `SELECT (SELECT count(*) FROM stores WHERE name LIKE 'PRUEBA-VO%')
                      + (SELECT count(*) FROM routes WHERE name LIKE 'PRUEBA-VO%') AS n`,
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
