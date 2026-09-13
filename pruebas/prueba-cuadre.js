require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * CUADRE DE VENTAS — la cobertura sale de la JORNADA REAL (`store_visits`), no del
 * calendario de las rutas.
 *
 * Regresión de dos mentiras que mostraba la pantalla:
 *   1. Días sin jornada con decenas de tiendas "programadas" y "sin visitar" en rojo.
 *   2. Las paradas cargadas al encargado ACTUAL de la ruta, aunque el período fuera de
 *      meses atrás y la hubiera trabajado otra persona.
 *
 * ES DE SOLO LECTURA: no escribe una sola fila.
 */
const path = RAIZ_SERVER + '/src/';
const { sequelize } = require(path + 'models');
const ctrl = require(path + 'controllers/sales_reports_controller');
sequelize.options.logging = false;

const CID = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const TZ = 'America/Bogota';
const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const mkRes = () => { const r = {}; r.status = () => r; r.json = j => { r._j = j; return r; }; return r; };
const cuadre = async (from, to, user_id = null) => {
    const res = mkRes();
    await ctrl.getCuadre({ user: { companyId: CID, companyTimezone: TZ }, query: { from, to, user_id } }, res);
    return res._j.data;
};

let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FALLA ${n}${d ? ' -> ' + d : ''}`); } };

// La verdad, contada directamente sobre store_visits.
const jornadaReal = (from, to, userId = null) => q(
    `SELECT COUNT(*) FILTER (WHERE sv.route_id IS NOT NULL)::int AS programadas,
            COUNT(*) FILTER (WHERE sv.route_id IS NOT NULL AND sv.status IN ('visited','completed'))::int AS visitadas,
            COUNT(*) FILTER (WHERE sv.route_id IS NOT NULL AND sv.status = 'pending')::int AS no_visitadas,
            COUNT(DISTINCT sv.route_id)::int AS num_rutas,
            COUNT(*) FILTER (WHERE sv.status IN ('visited','completed'))::int AS visitas
       FROM store_visits sv JOIN stores st ON st.id = sv.store_id
      WHERE st.company_id = :cid
        AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to
        ${userId ? 'AND sv.user_id = CAST(:u AS uuid)' : ''}`,
    { cid: CID, tz: TZ, from, to, u: userId }
).then(r => r[0]);

(async () => {
    const [{ hoy }] = await q(`SELECT to_char((now() AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS hoy`, { tz: TZ });

    // Un día CON jornada y otro SIN jornada, elegidos de los datos reales.
    const [{ dia }] = await q(
        `SELECT to_char((sv.date AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS dia
           FROM store_visits sv JOIN stores st ON st.id = sv.store_id
          WHERE st.company_id = :cid AND sv.route_id IS NOT NULL
          GROUP BY 1 ORDER BY 1 DESC LIMIT 1`, { cid: CID, tz: TZ });
    // Un día SIN jornada, buscado HACIA ADELANTE desde hoy.
    // Antes se buscaba entre el último día con jornada y hoy, y con datos reales el último
    // día con jornada ES hoy: `generate_series(hoy+1, hoy)` no devuelve filas y desestructurar
    // el arreglo vacío reventaba antes de llegar al primer assert.
    const filasVacio = await q(
        `SELECT to_char(d,'YYYY-MM-DD') AS vacio
           FROM generate_series((now() AT TIME ZONE :tz)::date,
                                (now() AT TIME ZONE :tz)::date + 60, interval '1 day') d
          WHERE NOT EXISTS (SELECT 1 FROM store_visits sv JOIN stores st ON st.id = sv.store_id
                             WHERE st.company_id = :cid AND (sv.date AT TIME ZONE :tz)::date = d::date)
          ORDER BY d ASC LIMIT 1`, { cid: CID, tz: TZ });
    const vacio = filasVacio.length ? filasVacio[0].vacio : null;

    console.log(`\n1)  Un dia SIN jornada no acusa a nadie  (${vacio || hoy})`);
    {
        const f = vacio || hoy;
        const d = await cuadre(f, f);
        check('Visitas programadas = 0', d.cobertura.programadas === 0, String(d.cobertura.programadas));
        check('Tiendas sin visitar = 0', d.cobertura.no_visitadas === 0, String(d.cobertura.no_visitadas));
        check('rutas = 0', d.cobertura.num_rutas === 0, String(d.cobertura.num_rutas));
        check('la tabla por vendedor sale vacia', d.por_vendedor.length === 0,
            JSON.stringify(d.por_vendedor.map(v => `${v.nombre}: ${v.programadas} prog`)));
    }

    console.log(`\n2)  Un dia CON jornada cuadra con store_visits  (${dia})`);
    {
        const d = await cuadre(dia, dia);
        const real = await jornadaReal(dia, dia);
        for (const k of ['programadas', 'visitadas', 'no_visitadas', 'num_rutas']) {
            check(`${k} = ${real[k]}`, d.cobertura[k] === real[k], `pantalla ${d.cobertura[k]}`);
        }
        check('programadas = visitadas + sin visitar',
            d.cobertura.programadas === d.cobertura.visitadas + d.cobertura.no_visitadas);
        check('la tarjeta Visitas concuerda con la jornada', d.resumen.visitas === real.visitas,
            `${d.resumen.visitas} vs ${real.visitas}`);
    }

    console.log('\n3)  La tabla por vendedor suma exactamente las tarjetas');
    for (const [f, t] of [[dia, dia], ['2026-07-01', '2026-07-31']]) {
        const d = await cuadre(f, t);
        const sum = (k) => d.por_vendedor.reduce((a, v) => a + v[k], 0);
        check(`${f}..${t}: suma de Program. = tarjeta`, sum('programadas') === d.cobertura.programadas,
            `${sum('programadas')} vs ${d.cobertura.programadas}`);
        check(`${f}..${t}: suma de No visito = tarjeta`, sum('no_visitadas') === d.cobertura.no_visitadas,
            `${sum('no_visitadas')} vs ${d.cobertura.no_visitadas}`);
        check(`${f}..${t}: suma de Visitas = tarjeta`, sum('visitas') === d.resumen.visitas);
        check(`${f}..${t}: suma de Total = tarjeta`,
            Math.round(sum('total_vendido')) === Math.round(d.resumen.total_vendido));
        check(`${f}..${t}: nadie aparece sin haber tenido ni una parada ni una visita`,
            d.por_vendedor.every(v => v.programadas > 0 || v.visitas > 0),
            JSON.stringify(d.por_vendedor.filter(v => !v.programadas && !v.visitas).map(v => v.nombre)));
    }

    console.log('\n4)  Filtrar por vendedor da lo mismo que su fila en el listado completo');
    {
        const d = await cuadre(dia, dia);
        for (const v of d.por_vendedor) {
            const f = await cuadre(dia, dia, v.user_id);
            check(`${v.nombre}: programadas`, f.cobertura.programadas === v.programadas,
                `${f.cobertura.programadas} vs ${v.programadas}`);
            check(`${v.nombre}: sin visitar`, f.cobertura.no_visitadas === v.no_visitadas,
                `${f.cobertura.no_visitadas} vs ${v.no_visitadas}`);
            check(`${v.nombre}: visitas`, f.resumen.visitas === v.visitas);
            check(`${v.nombre}: coherente consigo misma (visitadas + pendientes = programadas)`,
                f.cobertura.visitadas + f.cobertura.no_visitadas === f.cobertura.programadas);
            check(`${v.nombre}: la tarjeta no dice 0 rutas teniendo paradas`,
                f.cobertura.programadas === 0 || f.cobertura.num_rutas > 0,
                `rutas=${f.cobertura.num_rutas}, prog=${f.cobertura.programadas}`);
        }
    }

    console.log('\n5)  Un dia de RELEVO reparte las paradas entre las dos personas');
    {
        const [relevo] = await q(
            `SELECT to_char(sv.visit_day,'YYYY-MM-DD') AS dia, sv.route_id
               FROM store_visits sv JOIN stores st ON st.id = sv.store_id
              WHERE st.company_id = :cid AND sv.route_id IS NOT NULL
              GROUP BY 1,2 HAVING COUNT(DISTINCT sv.user_id) > 1
              ORDER BY 1 DESC LIMIT 1`, { cid: CID });
        if (!relevo) { console.log('  (sin dias de relevo en los datos)'); }
        else {
            const d = await cuadre(relevo.dia, relevo.dia);
            const real = await jornadaReal(relevo.dia, relevo.dia);
            const enRuta = d.por_vendedor.filter(v => v.programadas > 0);
            check(`${relevo.dia}: aparecen 2 o mas responsables`, enRuta.length >= 2,
                JSON.stringify(enRuta.map(v => `${v.nombre}=${v.programadas}`)));
            check(`${relevo.dia}: la suma sigue cuadrando`,
                enRuta.reduce((a, v) => a + v.programadas, 0) === real.programadas);
        }
    }

    console.log('\n6)  Una visita FUERA de ruta cuenta como visita, no como programada');
    {
        const [suelta] = await q(
            `SELECT to_char((sv.date AT TIME ZONE :tz)::date,'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
               FROM store_visits sv JOIN stores st ON st.id = sv.store_id
              WHERE st.company_id = :cid AND sv.route_id IS NULL
                AND sv.status IN ('visited','completed')
              GROUP BY 1 ORDER BY 1 DESC LIMIT 1`, { cid: CID, tz: TZ });
        if (!suelta) { console.log('  (no hay visitas fuera de ruta)'); }
        else {
            const d = await cuadre(suelta.dia, suelta.dia);
            const real = await jornadaReal(suelta.dia, suelta.dia);
            check(`${suelta.dia}: Visitas incluye las ${suelta.n} sueltas`, d.resumen.visitas === real.visitas);
            check(`${suelta.dia}: programadas las excluye`, d.cobertura.programadas === real.programadas,
                `${d.cobertura.programadas} vs ${real.programadas}`);
            check(`${suelta.dia}: por eso Visitas > visitadas de la jornada`,
                d.resumen.visitas > d.cobertura.visitadas,
                `${d.resumen.visitas} vs ${d.cobertura.visitadas}`);
        }
    }

    console.log('\n7)  El dinero sigue cuadrando en toda la pantalla');
    for (const [f, t] of [[dia, dia], ['2026-07-01', '2026-07-31']]) {
        const d = await cuadre(f, t);
        const metodos = d.por_metodo_pago.reduce((a, m) => a + m.total, 0);
        const nMetodos = d.por_metodo_pago.reduce((a, m) => a + m.num_ventas, 0);
        check(`${f}..${t}: Total vendido = TOTAL de metodos de pago`,
            Math.round(d.resumen.total_vendido) === Math.round(metodos), `${d.resumen.total_vendido} vs ${metodos}`);
        check(`${f}..${t}: numero de ventas coincide`, d.resumen.num_ventas === nMetodos,
            `${d.resumen.num_ventas} vs ${nMetodos}`);
    }

    console.log(`\n${fail === 0 ? '*** TODO EN VERDE ***' : '*** HAY FALLOS ***'}  ${ok} pasaron, ${fail} fallaron`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message, e.stack); process.exit(1); });
