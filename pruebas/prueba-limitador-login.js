/* ─────────────────────────────────────────────────────────────────────────────
 * Raíz del servidor, resuelta desde DONDE ESTÁ ESTE ARCHIVO.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

/**
 * EL LIMITADOR DEL LOGIN — `middlewares/smartRateLimit.middleware.js`.
 *
 * 🟢 **ESTA BATERÍA NO TOCA LA BASE DE DATOS**, y por eso es la única que no empieza con
 * `require('./_guardia-bd')`. No importa modelos, no abre Sequelize y no lee el `.env`: levanta un
 * Express de mentira en un puerto libre, le cuelga el limitador REAL y le manda peticiones. Se
 * puede correr siempre, en cualquier máquina y sin miedo.
 *
 * 🔴 LO QUE MÁS IMPORTA DEMOSTRAR, y son dos cosas que estuvieron rotas en producción:
 *
 *  1. **Que un login CORRECTO no gasta cupo.** Hasta el 2026-09-21 sí lo gastaba, con un tope de 5
 *     por ventana de 15 minutos. Como la sesión dura 16 h, los tres vendedores más el supervisor
 *     entran una vez al día cada uno y en la mañana agotaban el cupo entre todos: al siguiente le
 *     salía *"demasiados intentos"* **con la contraseña buena y en su primer intento**. Un
 *     limitador de login existe para frenar a quien ADIVINA contraseñas; quien acierta no está
 *     adivinando.
 *  2. **Que el cupo es POR CUENTA y no por IP.** En Cloud Run `req.ip` no distingue a nadie
 *     (`trust proxy` sin poner), así que contar por IP significaba que un vendedor le gastaba el
 *     cupo a otro. Contando por el correo intentado, cada cuenta lleva el suyo.
 *
 * Y dos que son agujeros evidentes si a alguien se le olvidan:
 *  3. Que el correo se **normaliza** — si no, se multiplica el cupo cambiando mayúsculas.
 *  4. Que sin correo en el cuerpo **se sigue limitando** (cae a la IP), en vez de quedar abierto.
 */
const path = require('path');
const SERVER = RAIZ_SERVER + '';
const M = (p) => path.join(SERVER, 'node_modules', p);

const express = require(M('express'));
const { createLoginLimiter } = require(path.join(SERVER, 'src', 'middlewares', 'smartRateLimit.middleware.js'));

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const titulo = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

/**
 * Levanta un servidor con el limitador real. `opciones` viaja tal cual a `createLoginLimiter`.
 *
 * 🔑 Cada llamada usa un `message` distinto. No es decorativo: los limitadores se reutilizan
 * cuando sus opciones coinciden (`limitersCache`), así que sin eso TODAS las pruebas de este
 * archivo compartirían el mismo contador y se estorbarían entre ellas. Es la misma trampa que
 * documenta `store_no_sale_reports_routes.js`.
 */
let semilla = 0;
function montar(opciones = {}) {
    semilla += 1;
    const app = express();
    app.use(express.json());
    const limitador = createLoginLimiter({ message: `prueba-${semilla}`, ...opciones });

    // Imita el login real: 401 si las credenciales no valen, 200 si valen.
    app.post('/login', limitador, (req, res) => {
        if (req.body && req.body.password === 'buena') return res.status(200).json({ ok: true });
        return res.status(401).json({ success: false, status: 401, message: 'Credenciales incorrectas' });
    });

    return new Promise((resolve) => {
        const servidor = app.listen(0, () => {
            const puerto = servidor.address().port;
            const pedir = async (cuerpo) => {
                const r = await fetch(`http://127.0.0.1:${puerto}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: cuerpo === undefined ? '{}' : JSON.stringify(cuerpo),
                });
                return r.status;
            };
            resolve({ pedir, cerrar: () => servidor.close() });
        });
    });
}

const repetir = async (pedir, veces, cuerpo) => {
    const salidas = [];
    for (let i = 0; i < veces; i += 1) salidas.push(await pedir(cuerpo));
    return salidas;
};

(async () => {
    /* ═══ 1. 🔴 Un login correcto NO gasta cupo ═══════════════════════════════════════════════ */
    titulo('1. El login CORRECTO no gasta cupo (el fallo de produccion)');
    {
        const { pedir, cerrar } = await montar({ maxByIP: 3, maxByUser: 3 });
        const salidas = await repetir(pedir, 30, { email: 'juan@x.com', password: 'buena' });
        assert(salidas.every((s) => s === 200), `30 entradas correctas seguidas: todas 200 (tope de 3)`);
        assert(!salidas.includes(429), 'ni un solo 429 — el vendedor entra cada mañana sin gastar nada');
        cerrar();
    }

    /* ═══ 2. Los fallos sí se cuentan ═════════════════════════════════════════════════════════ */
    titulo('2. Los intentos FALLIDOS si gastan cupo');
    {
        const { pedir, cerrar } = await montar({ maxByIP: 3, maxByUser: 3 });
        const salidas = await repetir(pedir, 6, { email: 'juan@x.com', password: 'mala' });
        assert(salidas.slice(0, 3).every((s) => s === 401), 'los 3 primeros fallos responden 401');
        assert(salidas.slice(3).every((s) => s === 429), 'del 4º en adelante, 429');
        assert(salidas.indexOf(429) === 3, 'el corte cae exactamente donde dice el tope');
        cerrar();
    }

    /* ═══ 3. 🔴 El cupo es POR CUENTA, no por IP ══════════════════════════════════════════════ */
    titulo('3. Cada cuenta lleva su cupo: nadie se lo gasta a otro');
    {
        const { pedir, cerrar } = await montar({ maxByIP: 3, maxByUser: 3 });

        await repetir(pedir, 4, { email: 'juan@x.com', password: 'mala' });
        assert(await pedir({ email: 'juan@x.com', password: 'mala' }) === 429, 'juan agotó SU cupo');

        // Misma IP (es la misma máquina), otro correo: tiene que entrar como si nada.
        assert(
            await pedir({ email: 'pedro@x.com', password: 'mala' }) === 401,
            '🔴 pedro falla con 401, NO con 429: los fallos de juan no le afectan',
        );
        assert(
            await pedir({ email: 'pedro@x.com', password: 'buena' }) === 200,
            'y pedro entra sin problema — esto es lo que arregla el problema de los vendedores',
        );
        assert(
            await pedir({ email: 'juan@x.com', password: 'buena' }) === 429,
            'mientras tanto juan sigue bloqueado aunque acierte: su cubo ya está lleno, correcto',
        );
        cerrar();
    }

    /* ═══ 4. 🔴 El correo se normaliza ════════════════════════════════════════════════════════ */
    titulo('4. Mayusculas y espacios NO multiplican el cupo');
    {
        const { pedir, cerrar } = await montar({ maxByIP: 2, maxByUser: 2 });
        await repetir(pedir, 3, { email: 'juan@x.com', password: 'mala' });
        assert(await pedir({ email: 'juan@x.com', password: 'mala' }) === 429, 'juan@x.com bloqueado');
        assert(
            await pedir({ email: 'JUAN@X.COM', password: 'mala' }) === 429,
            '🔴 en MAYÚSCULAS cae en el MISMO cubo (si no, se salta el limitador a voluntad)',
        );
        assert(
            await pedir({ email: '  juan@x.com  ', password: 'mala' }) === 429,
            'y con espacios alrededor, también',
        );
        assert(await pedir({ email: 'Juan@X.com', password: 'mala' }) === 429, 'mezclando mayúsculas, igual');
        cerrar();
    }

    /* ═══ 5. Sin correo utilizable se sigue limitando ═════════════════════════════════════════ */
    titulo('5. Un cuerpo sin correo NO queda sin limitar');
    {
        const { pedir, cerrar } = await montar({ maxByIP: 2, maxByUser: 2 });
        const sinCorreo = await repetir(pedir, 4, { password: 'mala' });
        assert(sinCorreo.includes(429), 'sin campo email se cae a la IP y se limita igual');
        cerrar();
    }
    {
        const { pedir, cerrar } = await montar({ maxByIP: 2, maxByUser: 2 });
        const raros = [];
        raros.push(await pedir(undefined));                       // cuerpo {}
        raros.push(await pedir({ email: null, password: 'x' }));  // email nulo
        raros.push(await pedir({ email: 123, password: 'x' }));   // email que no es texto
        raros.push(await pedir({ email: '   ', password: 'x' })); // email en blanco
        assert(raros.every((s) => s === 401 || s === 429), `ningún cuerpo raro revienta el limitador (${raros.join(' ')})`);
        cerrar();
    }

    /* ═══ 6. La trampa del cache de limitadores ═══════════════════════════════════════════════ */
    titulo('6. Dos limitadores con opciones distintas NO comparten cupo');
    {
        // Mismas opciones salvo `clavePorCorreo`: si esa opción no entrara en el `cacheKey`, el
        // segundo `montar` devolvería el MISMO limitador que el primero y compartirían contador.
        const a = await montar({ maxByIP: 2, maxByUser: 2, message: 'mismo-mensaje', clavePorCorreo: true });
        const b = await montar({ maxByIP: 2, maxByUser: 2, message: 'mismo-mensaje', clavePorCorreo: false });

        await repetir(a.pedir, 3, { email: 'juan@x.com', password: 'mala' });
        assert(await a.pedir({ email: 'juan@x.com', password: 'mala' }) === 429, 'el limitador A está agotado');
        assert(
            await b.pedir({ email: 'juan@x.com', password: 'mala' }) === 401,
            '🔴 el limitador B arranca limpio: `clavePorCorreo` SÍ entra en el cacheKey',
        );
        a.cerrar(); b.cerrar();
    }

    /* ═══ 7. Que el login de verdad sigue configurado como toca ═══════════════════════════════ */
    titulo('7. Los valores por defecto del login son los acordados');
    {
        const { pedir, cerrar } = await montar();   // sin tocar nada: 20 fallos por ventana
        const salidas = await repetir(pedir, 25, { email: 'ana@x.com', password: 'mala' });
        assert(salidas.indexOf(429) === 20, `el corte llega al fallo nº 21 (dio ${salidas.indexOf(429) + 1})`);
        assert(salidas.filter((s) => s === 401).length === 20, '20 fallos permitidos por ventana');
        cerrar();
    }
    {
        const { pedir, cerrar } = await montar();
        const buenas = await repetir(pedir, 50, { email: 'ana@x.com', password: 'buena' });
        assert(buenas.every((s) => s === 200), '50 entradas correctas seguidas con la configuración real: ninguna cortada');
        cerrar();
    }

    console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
    process.exit(fail ? 1 : 0);
})();
