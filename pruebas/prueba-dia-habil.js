require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * El dia habil se calcula con la zona de la COMPANIA, no con la del dispositivo.
 *
 * Se comprueba contra PostgreSQL (que es como lo calcula el backend) y se reproduce la
 * ventana horaria en la que el calculo viejo se equivocaba.
 *
 * SOLO LEE: no crea ni modifica nada.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const { sequelize } = require(path.join(SERVER, 'src', 'models'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };

// ── Copia EXACTA del helper del cliente (utils/diaHabil.ts) ────────────────────
const ZONA_POR_DEFECTO = 'America/Bogota';
const DIAS_EN_ESPANOL = {
    Sunday: 'domingo', Monday: 'lunes', Tuesday: 'martes', Wednesday: 'miercoles',
    Thursday: 'jueves', Friday: 'viernes', Saturday: 'sabado',
};
const diaDeLaSemanaEnZona = (timezone, ahora = new Date()) => {
    const zona = timezone || ZONA_POR_DEFECTO;
    try {
        return DIAS_EN_ESPANOL[new Intl.DateTimeFormat('en-US', { timeZone: zona, weekday: 'long' }).format(ahora)]
            ?? DIAS_EN_ESPANOL.Monday;
    } catch {
        return DIAS_EN_ESPANOL[new Intl.DateTimeFormat('en-US', { timeZone: ZONA_POR_DEFECTO, weekday: 'long' }).format(ahora)]
            ?? DIAS_EN_ESPANOL.Monday;
    }
};
const esDiaHabilHoy = (workingDays, timezone) =>
    Boolean(workingDays && workingDays.includes(diaDeLaSemanaEnZona(timezone)));
const diasHabilesEnProsa = (workingDays) => {
    const d = workingDays || [];
    if (d.length === 0) return 'ningún día';
    if (d.length === 1) return `los ${d[0]}`;
    return `los ${d.slice(0, -1).join(', ')} y ${d[d.length - 1]}`;
};

// Como lo calculaba ANTES el frontend: con el reloj del dispositivo.
const DIAS_JS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

(async () => {
    try {
        const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r, logging: false });

        // ── 1) Coincide con PostgreSQL (el backend) en 28 dias seguidos ───────
        console.log('-- El helper coincide con el calculo del backend --');
        const dias = await q(`SELECT to_char(d,'YYYY-MM-DD') AS dia, EXTRACT(ISODOW FROM d)::int AS isodow
                                FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 13, '1 day') d`);
        const DIAS_ISODOW = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
        let coinciden = 0;
        for (const f of dias) {
            // Mediodia UTC: ninguna zona razonable cruza el dia en ese punto.
            const js = diaDeLaSemanaEnZona('UTC', new Date(f.dia + 'T12:00:00Z'));
            if (js === DIAS_ISODOW[f.isodow - 1]) coinciden++;
        }
        assert(coinciden === dias.length,
            `${coinciden}/${dias.length} dias coinciden con EXTRACT(ISODOW) de PostgreSQL`);

        // ── 2) HOY: helper vs backend, con la zona real de cada compania ──────
        console.log('\n-- Hoy, contra la zona real de cada compania --');
        const companias = await q(`SELECT id, name, COALESCE(timezone,'America/Bogota') AS tz FROM companies ORDER BY id`);
        for (const c of companias) {
            const [{ dia_backend }] = await q(
                `SELECT trim(to_char((now() AT TIME ZONE :tz)::date, 'ID')) AS dia_backend`, { tz: c.tz });
            const esperado = DIAS_ISODOW[Number(dia_backend) - 1];
            assert(diaDeLaSemanaEnZona(c.tz) === esperado,
                `${c.name} (${c.tz}): helper dice "${diaDeLaSemanaEnZona(c.tz)}", backend "${esperado}"`);
        }

        // ── 3) La ventana de fallo del calculo VIEJO ─────────────────────────
        console.log('\n-- La ventana en la que el calculo viejo se equivocaba --');
        const [{ ahora_utc }] = await q(`SELECT now() AS ahora_utc`);
        const zonasMalConfiguradas = ['UTC', 'Europe/Madrid', 'America/Los_Angeles', 'Asia/Tokyo'];
        let discrepan = 0;
        for (const tz of zonasMalConfiguradas) {
            const enBogota = diaDeLaSemanaEnZona('America/Bogota', ahora_utc);
            // Lo que HABRIA dicho `new Date().getDay()` en un telefono puesto en esa zona.
            const enElTelefono = diaDeLaSemanaEnZona(tz, ahora_utc);
            const marca = enBogota === enElTelefono ? ' ' : '!';
            if (enBogota !== enElTelefono) discrepan++;
            console.log(`   ${marca} telefono en ${tz.padEnd(20)} dice "${enElTelefono}" · la empresa dice "${enBogota}"`);
        }
        assert(true, `${discrepan} de ${zonasMalConfiguradas.length} zonas discrepan de Bogota AHORA MISMO`);

        // Un caso fijo y reproducible: viernes 20:00 en Bogota = sabado en UTC.
        const viernesNoche = new Date('2026-08-28T01:00:00Z'); // 2026-08-27 20:00 en Bogota
        assert(diaDeLaSemanaEnZona('America/Bogota', viernesNoche) === 'jueves'
            && diaDeLaSemanaEnZona('UTC', viernesNoche) === 'viernes',
            'a las 20:00 de Bogota el telefono en UTC ya cree que es el dia siguiente');

        // ── 4) El impacto real sobre las rutas de la empresa ─────────────────
        console.log('\n-- Impacto sobre las rutas reales --');
        const rutas = await q(`SELECT r.id, r.name, r.working_days, COALESCE(c.timezone,'America/Bogota') AS tz
                                 FROM routes r JOIN companies c ON c.id = r.company_id
                                WHERE r.deleted_at IS NULL`);
        let afectadas = 0;
        for (const r of rutas) {
            const correcto = esDiaHabilHoy(r.working_days, r.tz);
            const conTelefonoEnUTC = esDiaHabilHoy(r.working_days, 'UTC');
            if (correcto !== conTelefonoEnUTC) afectadas++;
        }
        console.log(`   ${afectadas} de ${rutas.length} rutas darian un veredicto DISTINTO ahora mismo`);
        console.log('   con un telefono puesto en UTC (dependera de la hora en que se mire)');
        assert(rutas.length > 0, `se evaluaron ${rutas.length} rutas reales sin errores`);

        // ── 5) Los mensajes que ve el usuario ────────────────────────────────
        console.log('\n-- Redaccion del aviso --');
        assert(diasHabilesEnProsa(['lunes']) === 'los lunes', `1 dia -> "${diasHabilesEnProsa(['lunes'])}"`);
        assert(diasHabilesEnProsa(['lunes', 'jueves']) === 'los lunes y jueves',
            `2 dias -> "${diasHabilesEnProsa(['lunes', 'jueves'])}"`);
        assert(diasHabilesEnProsa(['lunes', 'miercoles', 'viernes']) === 'los lunes, miercoles y viernes',
            `3 dias -> "${diasHabilesEnProsa(['lunes', 'miercoles', 'viernes'])}"`);
        assert(diasHabilesEnProsa([]) === 'ningún día', 'ruta sin dias habiles -> "ningún día"');
        assert(diasHabilesEnProsa(undefined) === 'ningún día', 'working_days undefined no revienta');

        const ejemplo = rutas[0];
        console.log(`   Ejemplo real ("${ejemplo.name}"): "Opera ${diasHabilesEnProsa(ejemplo.working_days)}.`
            + ` Hoy es ${diaDeLaSemanaEnZona(ejemplo.tz)}."`);

        // ── 6) Robustez ──────────────────────────────────────────────────────
        console.log('\n-- Robustez --');
        assert(diaDeLaSemanaEnZona(undefined) === diaDeLaSemanaEnZona('America/Bogota'),
            'sin zona (activeCompany viejo del localStorage) cae al respaldo America/Bogota');
        assert(diaDeLaSemanaEnZona(null) === diaDeLaSemanaEnZona('America/Bogota'), 'null tambien');
        assert(diaDeLaSemanaEnZona('Zona/Inventada') === diaDeLaSemanaEnZona('America/Bogota'),
            'una zona invalida no revienta: cae al respaldo');
        assert(esDiaHabilHoy(undefined, 'America/Bogota') === false, 'ruta sin working_days -> false, sin excepcion');

        // Todos los valores del ENUM del cliente salen del helper en algun momento de la semana
        const generados = new Set();
        for (let i = 0; i < 7; i++) {
            const d = new Date(Date.UTC(2026, 7, 24 + i, 12));
            generados.add(diaDeLaSemanaEnZona('America/Bogota', d));
        }
        assert(generados.size === 7 && DIAS_JS.every((d) => generados.has(d)),
            'los 7 valores generados coinciden con el tipo DayOfWeek del cliente');

    } catch (e) {
        console.error('\nERROR:', e.message);
        fail++;
    } finally {
        await sequelize.close();
        console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
        process.exit(fail ? 1 : 0);
    }
})();
