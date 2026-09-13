require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * FASE 1b · tarea 1 — token de sesion de 16 h.
 * SOLO LEE: firma tokens en memoria y los pasa por el middleware real. No escribe nada.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));
const fs = require('fs');
const { sequelize } = require(path.join(SERVER, 'src', 'models'));
const { verifyToken } = require(path.join(SERVER, 'src', 'middlewares', 'jwt.middleware.js'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const H = 3600;

(async () => {
    try {
        const src = fs.readFileSync(path.join(SERVER, 'src/controllers/userController.js'), 'utf8');
        const auth = fs.readFileSync(path.join(SERVER, 'src/controllers/auth_controller.js'), 'utf8');

        console.log('\n-- 1) El codigo: la constante existe y se usa en los DOS sitios --');
        assert(/const TOKEN_SESION_EXPIRA_EN = '16h';/.test(src), "declara TOKEN_SESION_EXPIRA_EN = '16h'");
        const usos = (src.match(/expiresIn: TOKEN_SESION_EXPIRA_EN/g) || []).length;
        assert(usos === 2, `se usa en ${usos} sitios (login y autocambio de rol; deben ser 2)`);
        assert(!/expiresIn: '8h'/.test(src), 'no queda ningun 8h suelto en userController');
        assert(/expiresIn: '24h'/.test(auth), 'el token de restablecer contrasena SIGUE en 24h (no se toco)');

        console.log('\n-- 2) El token firmado dura 16 h de verdad --');
        const firmar = (exp) => jwt.sign({ userId: 'x', email: 'a@b.c', companyId: 'y', roleId: 1, userType: 'collaborator' }, process.env.JWT_SECRET, { expiresIn: exp });
        const d = jwt.decode(firmar('16h'));
        assert(d.exp - d.iat === 16 * H, `exp - iat = ${(d.exp - d.iat) / H} h`);
        const antes = jwt.decode(firmar('8h'));
        assert(d.exp - d.iat === 2 * (antes.exp - antes.iat), 'exactamente el doble que antes');

        console.log('\n-- 3) Cubre las jornadas reales --');
        const q = (s) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, logging: false });
        const [j] = await q(`WITH j AS (SELECT s.user_id, (s.sale_date AT TIME ZONE 'America/Bogota')::date AS dia,
                                    EXTRACT(EPOCH FROM (max(s.sale_date)-min(s.sale_date)))/3600.0 AS horas
                               FROM sales s WHERE s.deleted_at IS NULL GROUP BY 1,2 HAVING count(*)>3)
                             SELECT count(*)::int AS total, round(max(horas),1)::float8 AS maxima,
                                    count(*) FILTER (WHERE horas > 8)::int AS pasaban_de_8,
                                    count(*) FILTER (WHERE horas > 16)::int AS pasarian_de_16 FROM j`);
        console.log(`   ${j.total} jornadas reales · la mas larga ${j.maxima} h`);
        assert(j.pasaban_de_8 > 0, `${j.pasaban_de_8} jornadas se pasaban de las 8 h viejas (${Math.round(j.pasaban_de_8 * 100 / j.total)}%)`);
        assert(j.pasarian_de_16 === 0, `${j.pasarian_de_16} jornadas se pasarian de las 16 h nuevas (debe ser 0)`);

        console.log('\n-- 4) El middleware REAL acepta el token de 16 h --');
        const fila = (await q(`SELECT uc.user_id, uc.company_id, uc.role_id, uc.user_type, u.email
                                 FROM user_companies uc JOIN users u ON u.id = uc.user_id
                                WHERE uc.status = 'active' LIMIT 1`))[0];
        const real = (exp) => jwt.sign({ userId: fila.user_id, email: fila.email, companyId: fila.company_id, roleId: fila.role_id, userType: fila.user_type }, process.env.JWT_SECRET, { expiresIn: exp });
        const correr = async (token) => {
            const req = { headers: { authorization: 'Bearer ' + token } };
            const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
            let siguio = false;
            await verifyToken(req, res, () => { siguio = true; });
            return { req, res, siguio };
        };
        const r16 = await correr(real('16h'));
        assert(r16.siguio === true, 'token de 16 h -> el middleware llama a next() (pasa)');
        assert(r16.req.user && r16.req.user.id === fila.user_id, 'y rellena req.user igual que siempre');
        assert(r16.req.user.companyTimezone && r16.req.user.companySalesInventoryMode !== undefined,
            `sigue trayendo la zona (${r16.req.user.companyTimezone}) y el modo de ventas`);

        console.log('\n-- 5) Lo que NO debe pasar sigue sin pasar --');
        const rExp = await correr(real('-1s'));
        // OJO: el middleware devuelve 403 (no 401) para TODO fallo de auth. Ver el informe.
        assert(rExp.siguio === false && rExp.res.statusCode === 403,
            `un token EXPIRADO se sigue rechazando -> ${rExp.res.statusCode} ("${rExp.res.body?.message}")`);
        const rMal = await correr(jwt.sign({ userId: fila.user_id }, 'secreto-equivocado', { expiresIn: '16h' }));
        assert(rMal.siguio === false && rMal.res.statusCode === 403, 'un token firmado con otra clave se sigue rechazando');

        console.log('\n-- 6) Compatibilidad: las sesiones YA abiertas no se rompen --');
        const r8 = await correr(real('8h'));
        assert(r8.siguio === true, 'un token viejo de 8 h sigue siendo valido hasta que caduque solo');
        assert(16 * H * 1000 < 2147483647 * 10, 'nota: 16 h = 57.6M ms, muy por debajo del limite de setTimeout del navegador');

    } catch (e) {
        console.error('\nERROR: ' + e.message);
        fail++;
    } finally {
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
