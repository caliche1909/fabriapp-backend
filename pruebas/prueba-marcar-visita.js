require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * (f) Marcar visita cuando la tienda está en VARIAS rutas el mismo día.
 *
 * Monta el escenario que hoy no existe en los datos: una tienda propia, dos rutas propias,
 * las dos con jornada de HOY. Después llama al controlador REAL (sin servidor HTTP: se le
 * pasan req/res falsos) y comprueba qué parada cierra.
 *
 * SEGURIDAD: todo lo que crea es NUEVO (tiendas y rutas propias con nombre 'PRUEBA-F ...').
 * No toca ninguna fila existente y borra lo suyo al final, pase lo que pase.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const models = require(path.join(SERVER, 'src', 'models'));
const storesController = require(path.join(SERVER, 'src', 'controllers', 'stores_controller.js'));
const { stores, routes, store_visits, routes_stores, users, companies, sequelize } = models;

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };

// res falso: captura status + body de la respuesta del controlador.
const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const marcar = async ({ storeId, userId, companyId, tz, routeId, visitId, distance = 10 }) => {
    const req = {
        params: { store_id: String(storeId) },
        body: { distance, ...(routeId ? { route_id: routeId } : {}), ...(visitId ? { visit_id: visitId } : {}) },
        user: { id: userId, companyId, companyTimezone: tz },
    };
    const res = resFalso();
    await storesController.updateStoreAsVisited(req, res);
    return res;
};

(async () => {
    const creado = { stores: [], routes: [] };
    let companyId, userId, tz, hoy;

    try {
        // ── Escenario ─────────────────────────────────────────────────────────
        const compania = await companies.findOne({ order: [['id', 'ASC']] });
        companyId = compania.id;
        tz = compania.timezone || 'America/Bogota';
        const miembro = await sequelize.query(
            `SELECT user_id FROM user_companies WHERE company_id = :cid AND status='active' LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: companyId } }
        );
        userId = miembro[0].user_id;
        const [{ d }] = await sequelize.query(`SELECT (now() AT TIME ZONE :tz)::date AS d`,
            { type: sequelize.QueryTypes.SELECT, replacements: { tz } });
        hoy = d;

        const usuario = await users.findByPk(userId, { attributes: ['first_name', 'last_name'] });
        const nombreUsuario = `${usuario.first_name} ${usuario.last_name}`.trim();

        const tienda = await stores.create({
            name: 'PRUEBA-F Tienda en dos rutas', company_id: companyId,
            address: 'Calle falsa 123', store_type_id: 1, latitude: 1.2136, longitude: -77.2811,
        });
        creado.stores.push(tienda.id);

        const rutaA = await routes.create({ name: 'PRUEBA-F Ruta A', company_id: companyId, user_id: userId, working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] });
        const rutaB = await routes.create({ name: 'PRUEBA-F Ruta B', company_id: companyId, user_id: userId, working_days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] });
        creado.routes.push(rutaA.id, rutaB.id);

        await routes_stores.bulkCreate([
            { route_id: rutaA.id, store_id: tienda.id, company_id: companyId },
            { route_id: rutaB.id, store_id: tienda.id, company_id: companyId },
        ]);

        // Las dos jornadas de HOY: la misma tienda, dos rutas.
        const base = {
            store_id: tienda.id, user_id: userId, user_name: nombreUsuario, visit_day: hoy,
            store_name: tienda.name, store_address: tienda.address, status: 'pending',
            sale_amount: 0, date: sequelize.literal('now()'),
        };
        const vA = await store_visits.create({ ...base, route_id: rutaA.id, route_name: rutaA.name });
        const vB = await store_visits.create({ ...base, route_id: rutaB.id, route_name: rutaB.name });

        console.log(`\nTienda ${tienda.id} en rutas ${rutaA.id} y ${rutaB.id} · paradas ${vA.id} y ${vB.id} · día ${hoy}\n`);

        const estado = async (id) => (await store_visits.findByPk(id)).status;
        const ctx = { storeId: tienda.id, userId, companyId, tz };

        // ── 1) SIN contexto: antes cerraba una al azar; ahora debe rechazar ────
        const r1 = await marcar(ctx);
        assert(r1.statusCode === 409 && /varias rutas/i.test(r1.body?.message || ''),
            `sin route_id ni visit_id → 409 pidiendo contexto ("${r1.body?.message}")`);
        assert(await estado(vA.id) === 'pending' && await estado(vB.id) === 'pending',
            'ninguna de las dos paradas se tocó');

        // ── 2) CON visit_id: cierra EXACTAMENTE esa ───────────────────────────
        const r2 = await marcar({ ...ctx, visitId: vB.id });
        assert(r2.statusCode === 200, `con visit_id de la ruta B → 200 ("${r2.body?.message}")`);
        assert(await estado(vB.id) === 'visited', 'la parada de la ruta B queda visitada');
        assert(await estado(vA.id) === 'pending', 'la parada de la ruta A sigue pendiente (no se tocó la ajena)');

        // ── 3) CON route_id (cliente viejo): sigue funcionando ────────────────
        const r3 = await marcar({ ...ctx, routeId: rutaA.id });
        assert(r3.statusCode === 200, `con route_id de la ruta A → 200 (respaldo del cliente viejo)`);
        assert(await estado(vA.id) === 'visited', 'la parada de la ruta A queda visitada');

        // ── 4) visit_id que no es de esta tienda → rechazo explícito ──────────
        const ajena = await store_visits.findOne({ where: { visit_day: hoy }, order: [['id', 'ASC']] });
        const idAjeno = (ajena && ajena.store_id !== tienda.id) ? ajena.id : 999999999;
        const r4 = await marcar({ ...ctx, visitId: idAjeno });
        assert(r4.statusCode === 409 && /no corresponde a esta tienda/i.test(r4.body?.message || ''),
            `visit_id ajeno → 409 explícito ("${r4.body?.message}")`);

        // ── 5) Una sola parada y sin contexto: sigue funcionando como siempre ──
        await store_visits.destroy({ where: { id: vB.id } });
        await store_visits.update({ status: 'pending' }, { where: { id: vA.id } });
        const r5 = await marcar(ctx);
        assert(r5.statusCode === 200, 'con UNA sola parada y sin contexto → 200 (no se rompió el caso normal)');
        assert(await estado(vA.id) === 'visited', 'esa única parada queda visitada');

    } catch (e) {
        console.error('\nERROR:', e.message);
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
            const resto = await sequelize.query(
                `SELECT count(*)::int AS n FROM stores WHERE name LIKE 'PRUEBA-F%'
                 UNION ALL SELECT count(*)::int FROM routes WHERE name LIKE 'PRUEBA-F%'`,
                { type: sequelize.QueryTypes.SELECT });
            console.log(`\nLimpieza: quedan ${resto.map((r) => r.n).join(' y ')} filas de prueba (deben ser 0 y 0).`);
        } catch (e) {
            console.error('LIMPIEZA FALLIDA:', e.message);
        }
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
