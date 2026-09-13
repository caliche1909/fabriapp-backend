require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * FASE 1b · tarea 7b — codigos estables en jwt.middleware.
 * SOLO LEE: firma tokens en memoria y los pasa por el middleware real. No escribe nada.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));
const { sequelize } = require(path.join(SERVER, 'src', 'models'));
const mw = require(path.join(SERVER, 'src', 'middlewares', 'jwt.middleware.js'));
const { CODIGOS } = require(path.join(SERVER, 'src', 'utils', 'sincronizacion.js'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const titulo = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

const correr = async (middleware, req) => {
    const res = {
        statusCode: null, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
    let siguio = false;
    await middleware(req, res, () => { siguio = true; });
    return { req, res, siguio };
};

(async () => {
    const errOriginal = console.error;
    try {
        const q = (s) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, logging: false });
        const noOwner = await q("SELECT uc.user_id, uc.company_id, uc.role_id, uc.user_type, u.email"
            + " FROM user_companies uc JOIN users u ON u.id = uc.user_id"
            + " WHERE uc.status='active' AND uc.user_type <> 'owner' LIMIT 1");
        const cualquiera = await q("SELECT uc.user_id, uc.company_id, uc.role_id, uc.user_type, u.email"
            + " FROM user_companies uc JOIN users u ON u.id = uc.user_id"
            + " WHERE uc.status='active' LIMIT 1");
        const fila = noOwner[0] || cualquiera[0];

        const firmar = (extra, opts) => jwt.sign(Object.assign({
            userId: fila.user_id, email: fila.email, companyId: fila.company_id,
            roleId: fila.role_id, userType: fila.user_type,
        }, extra || {}), process.env.JWT_SECRET, opts || { expiresIn: '16h' });
        const conToken = (t) => ({ headers: { authorization: 'Bearer ' + t } });

        console.log('\nUsuario de prueba: ' + fila.user_type + ' de la compania ' + fila.company_id);

        titulo('1) El camino feliz sigue intacto');
        const feliz = await correr(mw.verifyToken, conToken(firmar()));
        assert(feliz.siguio === true, 'token bueno -> next()');
        assert(feliz.req.user && feliz.req.user.id === fila.user_id, 'req.user se rellena igual que siempre');
        assert(Boolean(feliz.req.user.companyTimezone) && feliz.req.user.companySalesInventoryMode !== undefined,
            'sigue trayendo zona horaria y modo de ventas');

        titulo('2) Cada fallo trae SU codigo (esto es lo nuevo)');
        console.error = function () { };   // silenciar los logs esperados del middleware

        const sinCabecera = await correr(mw.verifyToken, { headers: {} });
        assert(sinCabecera.res.body && sinCabecera.res.body.code === CODIGOS.SESION_AUSENTE,
            'sin cabecera Authorization -> ' + sinCabecera.res.statusCode + ' ' + (sinCabecera.res.body || {}).code);

        const caducado = await correr(mw.verifyToken, conToken(firmar(null, { expiresIn: '-1s' })));
        assert(caducado.res.body.code === CODIGOS.SESION_EXPIRADA,
            'token CADUCADO -> ' + caducado.res.statusCode + ' ' + caducado.res.body.code
            + ' ("' + caducado.res.body.message + '")');
        assert(/sesion expiro|sesión expiró/i.test(caducado.res.body.message),
            'y el mensaje ya le dice al usuario que hacer');

        const firmaMala = await correr(mw.verifyToken,
            conToken(jwt.sign({ userId: fila.user_id }, 'clave-equivocada', { expiresIn: '16h' })));
        assert(firmaMala.res.body.code === CODIGOS.SESION_INVALIDA,
            'firma equivocada -> ' + firmaMala.res.statusCode + ' ' + firmaMala.res.body.code);

        const basura = await correr(mw.verifyToken, conToken('esto-no-es-un-jwt'));
        assert(basura.res.body.code === CODIGOS.SESION_INVALIDA, 'token corrupto -> ' + basura.res.body.code);

        // Membresia perdida: se simula con una compania que existe pero de la que NO es miembro.
        const otras = await q("SELECT id FROM companies WHERE id <> '" + fila.company_id + "' LIMIT 1");
        if (otras.length) {
            const revocada = await correr(mw.verifyToken, conToken(firmar({ companyId: otras[0].id })));
            assert(revocada.res.body.code === CODIGOS.SESION_REVOCADA,
                'ya no es miembro de esa compania -> ' + revocada.res.statusCode + ' ' + revocada.res.body.code);
        } else {
            assert(true, '(no hay una segunda compania con la que probar SESION_REVOCADA)');
        }

        titulo('3) Falta de PERMISO se distingue de sesion caducada');
        const reqOk = { headers: { authorization: 'Bearer ' + firmar() } };
        await correr(mw.verifyToken, reqOk);
        const sinPermiso = await correr(mw.checkPermission('permiso_que_no_existe_jamas'), reqOk);
        if (reqOk.user.userType === 'owner') {
            assert(sinPermiso.siguio === true, '(el usuario de prueba es owner: pasa siempre, como debe)');
        } else {
            assert(sinPermiso.res.body.code === CODIGOS.SIN_PERMISO,
                'permiso inexistente -> ' + sinPermiso.res.statusCode + ' ' + sinPermiso.res.body.code);
            assert(sinPermiso.res.body.code !== CODIGOS.SESION_EXPIRADA,
                'y NO es SESION_EXPIRADA: la cola lo DESCARTA en vez de pausarse y pedir login');
            const varios = await correr(mw.checkAnyPermission(['nope_1', 'nope_2']), reqOk);
            assert(varios.res.body.code === CODIGOS.SIN_PERMISO, 'checkAnyPermission -> ' + varios.res.body.code);
            const todos = await correr(mw.checkPermissions(['nope_1', 'nope_2']), reqOk);
            assert(todos.res.body.code === CODIGOS.SIN_PERMISO, 'checkPermissions -> ' + todos.res.body.code);
        }
        const sinUser = await correr(mw.checkPermission('lo_que_sea'), { headers: {} });
        assert(sinUser.res.body.code === CODIGOS.SESION_AUSENTE, 'sin req.user -> ' + sinUser.res.body.code);

        titulo('4) Un fallo de BASE DE DATOS ya no se disfraza de sesion invalida');
        const modelo = sequelize.models.user_companies;
        const findOneReal = modelo.findOne;
        modelo.findOne = async function () { throw new Error('conexion perdida con la BD'); };
        const bdCaida = await correr(mw.verifyToken, conToken(firmar()));
        modelo.findOne = findOneReal;
        assert(bdCaida.res.statusCode === 500,
            'la BD falla -> ' + bdCaida.res.statusCode + ' (antes era 403 "Token invalido o expirado")');
        assert(!bdCaida.res.body.code,
            'sin codigo de sesion: la cola lo trata como 5xx y REINTENTA con backoff, no pide login');
        const trasFallo = await correr(mw.verifyToken, conToken(firmar()));
        assert(trasFallo.siguio === true, 'y al recuperarse la BD, el mismo token vuelve a pasar');

        titulo('5) Aditivo: nada de lo que ya existia cambio');
        assert(sinCabecera.res.statusCode === 403 && caducado.res.statusCode === 403
            && firmaMala.res.statusCode === 403,
            'los fallos de sesion siguen siendo 403 (no se toco el codigo HTTP)');
        assert(typeof sinCabecera.res.body.message === 'string' && sinCabecera.res.body.success === false,
            'la forma (success + message) es la de siempre: quien solo lea message no nota nada');

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
