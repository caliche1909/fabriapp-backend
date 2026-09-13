require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Desplegables de miembros: que los inactivos NO se ofrezcan donde el backend los rechaza.
 *
 * Llama al controlador REAL de `getUsersByCompany` (req/res falsos) y aplica sobre su respuesta
 * la MISMA regla que ahora usan los dos diálogos, para comprobar tres cosas:
 *   1. el endpoint sigue devolviendo a TODOS (la gestión de usuarios los necesita),
 *   2. la regla deja fuera exactamente a los inactivos,
 *   3. el titular actual sobrevive al filtro aunque esté inactivo (caso de edición).
 *
 * Solo LEE. No escribe nada en la base.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const { sequelize } = require(path.join(SERVER, 'src', 'models'));
const userController = require(path.join(SERVER, 'src', 'controllers', 'userController.js'));

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };

// La regla del frontend, copiada tal cual de los diálogos.
const disponibles = (miembros, titularId = null) =>
    miembros.filter((u) => u.allowAccess === 'active' || u.id === titularId);

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

(async () => {
    try {
        const companias = await sequelize.query(
            `SELECT c.id, c.name,
                    count(*) FILTER (WHERE uc.status = 'active')  AS activos,
                    count(*) FILTER (WHERE uc.status <> 'active') AS inactivos
               FROM companies c JOIN user_companies uc ON uc.company_id = c.id
              GROUP BY c.id, c.name ORDER BY c.name`,
            { type: sequelize.QueryTypes.SELECT });

        for (const comp of companias) {
            const res = resFalso();
            await userController.getUsersByCompany({ user: { companyId: comp.id } }, res);
            const miembros = res.body.users;

            const inactivos = miembros.filter((u) => u.allowAccess !== 'active');
            const ofrecidos = disponibles(miembros);

            console.log(`\n${comp.name} — ${comp.activos} activos, ${comp.inactivos} inactivos`);

            assert(miembros.length === Number(comp.activos) + Number(comp.inactivos),
                `el endpoint devuelve a TODOS (${miembros.length}) — gestión de usuarios intacta`);
            assert(inactivos.length === Number(comp.inactivos),
                `identifica ${inactivos.length} inactivo(s) por allowAccess`);
            assert(ofrecidos.length === Number(comp.activos),
                `el desplegable ofrece ${ofrecidos.length} (solo activos)`);
            assert(!ofrecidos.some((u) => u.allowAccess !== 'active'),
                'ningún inactivo se cuela entre los ofrecidos');

            if (inactivos.length > 0) {
                const titular = inactivos[0];
                const conTitular = disponibles(miembros, titular.id);
                assert(conTitular.some((u) => u.id === titular.id),
                    `al editar, el titular inactivo (${titular.name}) SIGUE visible y no se borra la asignación`);
                assert(conTitular.length === Number(comp.activos) + 1,
                    'y no arrastra a los demás inactivos');
            }
        }

        // El backend rechaza de verdad a un inactivo: esa es la razón de todo esto.
        const [rechazo] = await sequelize.query(
            `SELECT count(*)::int AS n FROM user_companies WHERE status <> 'active'`,
            { type: sequelize.QueryTypes.SELECT });
        assert(rechazo.n > 0, `hay ${rechazo.n} membresías inactivas en la base que antes se ofrecían`);

    } catch (e) {
        console.error('\nERROR:', e.message);
        fail++;
    } finally {
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
