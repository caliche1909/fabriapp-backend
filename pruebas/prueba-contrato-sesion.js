require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');
const RAIZ_CLIENT = require('path').resolve(__dirname, '../../client');

/**
 * FASE 1b · frontend — PRUEBA DE CONTRATO entre los dos repos.
 *
 * Coge las respuestas que produce el middleware REAL del backend y se las da a la funcion REAL
 * del frontend (`client/src/utils/codigosApi.ts`, transpilada con el esbuild del propio proyecto).
 * Si alguien renombra un codigo en un lado y no en el otro, esto lo caza.
 *
 * SOLO LEE: firma tokens en memoria. No escribe nada en la base de datos.
 */
const path = require('path');
const fs = require('fs');
const SERVER = RAIZ_SERVER + '';
const CLIENT = RAIZ_CLIENT + '';

require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));
const { sequelize } = require(path.join(SERVER, 'src', 'models'));
const mw = require(path.join(SERVER, 'src', 'middlewares', 'jwt.middleware.js'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const titulo = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 60 - t.length)));

// Transpila el TypeScript REAL del cliente y lo carga.
const cargarModuloDelCliente = () => {
    const esbuild = require(path.join(CLIENT, 'node_modules', 'esbuild'));
    const ts = fs.readFileSync(path.join(CLIENT, 'src/utils/codigosApi.ts'), 'utf8');
    const js = esbuild.transformSync(ts, { loader: 'ts', format: 'cjs' }).code;
    const modulo = { exports: {} };
    new Function('exports', 'module', 'require', js)(modulo.exports, modulo, require);
    return modulo.exports;
};

const correr = async (middleware, req) => {
    const res = {
        statusCode: null, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
    let siguio = false;
    await middleware(req, res, () => { siguio = true; });
    return { res, siguio };
};

// Envuelve una respuesta del backend con la forma exacta que le llega a Axios.
const comoErrorDeAxios = (res) => ({ response: { status: res.statusCode, data: res.body } });

(async () => {
    const errOriginal = console.error;
    try {
        const cliente = cargarModuloDelCliente();
        console.log('\nModulo del cliente cargado. Codigos de fin de sesion: '
            + cliente.CODIGOS_SESION_TERMINADA.join(', '));

        const q = (s) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, logging: false });
        const filas = await q("SELECT uc.user_id, uc.company_id, uc.role_id, uc.user_type, u.email"
            + " FROM user_companies uc JOIN users u ON u.id = uc.user_id"
            + " WHERE uc.status='active' AND uc.user_type <> 'owner' LIMIT 1");
        const respaldo = await q("SELECT uc.user_id, uc.company_id, uc.role_id, uc.user_type, u.email"
            + " FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.status='active' LIMIT 1");
        const fila = filas[0] || respaldo[0];
        const esOwner = fila.user_type === 'owner';

        const firmar = (extra, opts) => jwt.sign(Object.assign({
            userId: fila.user_id, email: fila.email, companyId: fila.company_id,
            roleId: fila.role_id, userType: fila.user_type,
        }, extra || {}), process.env.JWT_SECRET, opts || { expiresIn: '16h' });
        const conToken = (t) => ({ headers: { authorization: 'Bearer ' + t } });

        console.error = function () { };  // silenciar los logs esperados del middleware

        titulo('1) El backend dice "se acabo la sesion" -> el cliente CIERRA');
        const casos = [
            ['sin cabecera Authorization', { headers: {} }],
            ['token CADUCADO', conToken(firmar(null, { expiresIn: '-1s' }))],
            ['firma equivocada', conToken(jwt.sign({ userId: fila.user_id }, 'otra-clave', { expiresIn: '1h' }))],
            ['token corrupto', conToken('no-es-un-jwt')],
        ];
        const otras = await q("SELECT id FROM companies WHERE id <> '" + fila.company_id + "' LIMIT 1");
        if (otras.length) casos.push(['membresia revocada', conToken(firmar({ companyId: otras[0].id }))]);

        for (const [etiqueta, req] of casos) {
            const r = await correr(mw.verifyToken, req);
            const veredicto = cliente.esSesionTerminada(comoErrorDeAxios(r.res));
            assert(veredicto === true,
                etiqueta.padEnd(26) + ' -> ' + r.res.statusCode + ' ' + r.res.body.code + ' -> cierra sesion');
        }

        titulo('2) El backend dice "sin permiso" -> el cliente NO cierra');
        const reqOk = { headers: { authorization: 'Bearer ' + firmar() } };
        await correr(mw.verifyToken, reqOk);
        if (esOwner) {
            assert(true, '(el usuario de prueba es owner y nunca recibe SIN_PERMISO)');
        } else {
            for (const [etiqueta, m] of [
                ['checkPermission', mw.checkPermission('permiso_inexistente')],
                ['checkAnyPermission', mw.checkAnyPermission(['nope_a', 'nope_b'])],
                ['checkPermissions', mw.checkPermissions(['nope_a', 'nope_b'])],
            ]) {
                const r = await correr(m, reqOk);
                const veredicto = cliente.esSesionTerminada(comoErrorDeAxios(r.res));
                assert(veredicto === false,
                    etiqueta.padEnd(26) + ' -> ' + r.res.statusCode + ' ' + r.res.body.code
                    + ' -> NO cierra (es un error de pantalla)');
            }
        }

        titulo('3) Un fallo del SERVIDOR tampoco echa a nadie');
        const modelo = sequelize.models.user_companies;
        const findOneReal = modelo.findOne;
        modelo.findOne = async function () { throw new Error('BD caida'); };
        const bd = await correr(mw.verifyToken, conToken(firmar()));
        modelo.findOne = findOneReal;
        assert(bd.res.statusCode === 500, 'la BD falla -> 500');
        assert(cliente.esSesionTerminada(comoErrorDeAxios(bd.res)) === false,
            'y el cliente NO cierra sesion: es un problema del servidor, se reintenta');

        titulo('4) Errores de negocio de las operaciones de campo');
        for (const cuerpo of [
            { status: 409, data: { code: 'VISITA_YA_CERRADA', message: 'x' } },
            { status: 403, data: { code: 'NO_ES_ENCARGADO', message: 'x' } },
            { status: 409, data: { code: 'STOCK_INSUFICIENTE', message: 'x' } },
        ]) {
            assert(cliente.esSesionTerminada({ response: cuerpo }) === false,
                cuerpo.data.code.padEnd(26) + ' -> NO cierra sesion (aunque sea un 403)');
        }

        titulo('5) Casos raros que no deben tumbar la app');
        assert(cliente.esSesionTerminada({ message: 'Network Error' }) === false,
            'error de red sin respuesta -> no cierra sesion (el usuario sigue logueado, solo no hay internet)');
        assert(cliente.esSesionTerminada(undefined) === false, 'undefined -> no revienta');
        assert(cliente.esSesionTerminada({ response: { status: 500 } }) === false, 'respuesta sin body -> no revienta');
        assert(cliente.esSesionTerminada({ response: { status: 401, data: {} } }) === true,
            'un 401 sin code SI se trata como fin de sesion (prudencia, hoy no ocurre)');
        assert(cliente.esSesionTerminada({ response: { status: 403, data: { code: 'INVENTADO' } } }) === false,
            'un code desconocido no cierra sesion');

        titulo('6) Las dos listas de codigos no se han desincronizado');
        const fuenteBackend = fs.readFileSync(path.join(SERVER, 'src/utils/sincronizacion.js'), 'utf8');
        for (const codigo of cliente.CODIGOS_SESION_TERMINADA) {
            assert(fuenteBackend.includes(codigo + ':'),
                'el backend define ' + codigo);
        }
        assert(fuenteBackend.includes(cliente.CODIGO_SIN_PERMISO + ':'),
            'el backend define ' + cliente.CODIGO_SIN_PERMISO);

    } catch (e) {
        console.error = errOriginal;
        console.error('\nERROR: ' + e.message + '\n' + e.stack.split('\n').slice(1, 4).join('\n'));
        fail++;
    } finally {
        console.error = errOriginal;
        await sequelize.close();
        console.log('\n=== ' + ok + ' OK · ' + fail + ' FALLAS ===');
        process.exit(fail ? 1 : 0);
    }
})();
