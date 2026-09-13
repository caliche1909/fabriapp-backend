require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * Selector de vendedor del Cuadre: que se pueda filtrar por quien ya no está en la empresa.
 *
 * Llama a los controladores REALES (`getSellers` y `getCuadre`, con req/res falsos) y comprueba
 * lo único que importa de verdad: que la suma de lo que se puede filtrar cuadre con el total.
 *
 * Solo LEE. No escribe nada.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const { sequelize } = require(path.join(SERVER, 'src', 'models'));
const reportes = require(path.join(SERVER, 'src', 'controllers', 'sales_reports_controller.js'));

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log(`   OK    ${msg}`); } else { fail++; console.log(`   FALLA ${msg}`); } };
const money = (n) => '$' + Math.round(n).toLocaleString('es-CO');

const resFalso = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const llamar = async (metodo, req) => {
    const res = resFalso();
    await reportes[metodo](req, res);
    return res;
};

(async () => {
    try {
        const [comp] = await sequelize.query(
            `SELECT id, name, timezone FROM companies WHERE name ILIKE '%SILO%' LIMIT 1`,
            { type: sequelize.QueryTypes.SELECT });
        const user = { companyId: comp.id, companyTimezone: comp.timezone };
        const FROM = '2026-02-01', TO = '2026-02-28';

        // ── 1) El selector ────────────────────────────────────────────────────
        const sel = await llamar('getSellers', { user });
        const vendedores = sel.body.data;
        const inactivos = vendedores.filter((v) => !v.activo);

        console.log(`\n${comp.name} · selector: ${vendedores.length} vendedores (${inactivos.length} ya no están)\n`);
        vendedores.forEach((v) => console.log(`   · ${v.nombre}${v.activo ? '' : '  — ya no está'}`));

        assert(sel.statusCode === 200 && Array.isArray(vendedores), 'el selector responde 200 con una lista');
        assert(inactivos.length > 0, `ahora incluye a ${inactivos.length} que ya no están en la empresa`);
        assert(vendedores.every((v) => typeof v.activo === 'boolean'), 'cada uno trae su bandera `activo`');

        // Los activos van primero: el uso diario no cambia de aspecto.
        const primerInactivo = vendedores.findIndex((v) => !v.activo);
        const ultimoActivo = vendedores.map((v) => v.activo).lastIndexOf(true);
        assert(primerInactivo === -1 || primerInactivo > ultimoActivo, 'los activos salen primero en la lista');

        // Nadie inactivo Y sin historia (filtrar por él solo daría ceros).
        const sinHistoria = await sequelize.query(
            `SELECT u.id FROM user_companies uc JOIN users u ON u.id = uc.user_id
              WHERE uc.company_id = :cid AND uc.status <> 'active'
                AND NOT EXISTS (SELECT 1 FROM store_visits sv JOIN stores st ON st.id = sv.store_id
                                 WHERE sv.user_id = u.id AND st.company_id = :cid)
                AND NOT EXISTS (SELECT 1 FROM sales sa WHERE sa.user_id = u.id AND sa.company_id = :cid)`,
            { type: sequelize.QueryTypes.SELECT, replacements: { cid: comp.id } });
        assert(!vendedores.some((v) => sinHistoria.some((s) => s.id === v.user_id)),
            `los ${sinHistoria.length} inactivos SIN historia no ensucian la lista`);

        // ── 2) La prueba de fuego: ¿cuadra la suma? ───────────────────────────
        const total = await llamar('getCuadre', { user, query: { from: FROM, to: TO } });
        const totalMes = total.body.data.resumen.total_vendido;
        const tabla = total.body.data.por_vendedor;

        console.log(`\nFebrero 2026 · total del mes ${money(totalMes)} · la tabla lista ${tabla.length} vendedores\n`);

        let suma = 0;
        for (const v of vendedores) {
            const r = await llamar('getCuadre', { user, query: { from: FROM, to: TO, user_id: v.user_id } });
            const t = r.body.data.resumen.total_vendido;
            suma += t;
            if (t > 0) console.log(`   ${v.nombre}${v.activo ? '' : ' (ya no está)'}: ${money(t)}`);
        }

        assert(Math.abs(suma - totalMes) < 1,
            `filtrando uno por uno se llega a ${money(suma)} = el total del mes ${money(totalMes)}`);
        assert(tabla.every((f) => vendedores.some((v) => v.user_id === f.user_id)),
            'TODO nombre de la tabla se puede seleccionar en el filtro (era el bug)');

        // ── 3) El ex-vendedor concreto que motivó todo ────────────────────────
        const julian = vendedores.find((v) => /Julian/i.test(v.nombre) && !v.activo);
        if (julian) {
            const r = await llamar('getCuadre', { user, query: { from: FROM, to: TO, user_id: julian.user_id } });
            assert(r.body.data.resumen.total_vendido > 0,
                `${julian.nombre} ya se puede filtrar: ${money(r.body.data.resumen.total_vendido)} en febrero`);
            const lo = await llamar('getLostOpportunity', { user, query: { from: FROM, to: TO, user_id: julian.user_id } });
            assert(lo.statusCode === 200, 'la oportunidad perdida también acepta filtrar por él');
        } else {
            assert(false, 'no se encontró al ex-vendedor Julian en el selector');
        }

    } catch (e) {
        console.error('\nERROR:', e.message);
        fail++;
    } finally {
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
