require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * ───────────────────────────────────────────────────────────────────────────── */
const path = require('path');
const fs = require('fs');
const RAIZ_SERVER = path.resolve(__dirname, '..');
const RAIZ_CLIENT = path.resolve(__dirname, '../../client');

/**
 * "MI BODEGA" — que el vendedor vea SOLO la suya, la reciba, y NO pueda ajustarla.
 *
 * 🔴 LAS DOS COSAS QUE MÁS IMPORTA DEMOSTRAR:
 *
 *  1. **Que no puede leer la bodega ajena.** `getBalancesByLocation` comprobaba la COMPAÑÍA pero
 *     no la BODEGA, y se apoyaba en un `checkPermission('view_products_stock')` en la ruta. Ese
 *     permiso significa "ver el stock de la compañía": dárselo a un vendedor para que viera su
 *     camión le habría abierto también la central y los camiones de sus compañeros.
 *
 *  2. **Que no puede ajustar la suya.** Hasta el 2026-09-25 ser el responsable bastaba para
 *     ajustar, y con "Mi bodega" abierta al rol SELLER eso significaba que un vendedor podía
 *     bajarse unidades de su propio camión sin que nadie lo aprobara. Decisión del usuario: *"el
 *     vendedor no puede ajustar su bodega, solo recibe"*. RECIBIR sí sigue siendo suyo, porque
 *     ahí hay una contraparte que responde por el otro lado.
 *
 * Y una tercera, de otra naturaleza: **que los códigos de submódulo que pregunta el frontend
 * existan de verdad**. El menú se pinta comparando una cadena escrita a mano en el layout con el
 * `code` de la tabla `submodules`; si no coinciden, el item **no aparece y nada avisa**. Llevaba
 * pasando con `tracking`, al que el layout llamaba `view-tracking` y el redirector
 * `users-ubications`: 6 usuarios con el permiso y sin el menú.
 *
 * Crea su propia bodega y la borra al final.
 */
const { sequelize, inventory_locations, products, stock_transfers, stock_transfer_items,
    product_stock_movements } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const stockCtrl = require(RAIZ_SERVER + '/src/controllers/product_stock_controller.js');
const traspasosCtrl = require(RAIZ_SERVER + '/src/controllers/stock_transfers_controller.js');

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };
const titulo = (t) => console.log(`\n${t}\n${'─'.repeat(Math.min(78, t.length + 2))}`);

/** Todos los .ts/.tsx del cliente, en una lista. */
const fuentesDelCliente = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) fuentesDelCliente(p, acc);
        else if (/\.tsx?$/.test(e.name)) acc.push(p);
    }
    return acc;
};

(async () => {
    const prodsCreados = [], bodegasCreadas = [], traspasosCreados = [];
    let COMPANY = null, central = null;
    try {
        const [comp] = await q(`
            SELECT c.id FROM companies c
             WHERE EXISTS (SELECT 1 FROM inventory_locations il
                            WHERE il.company_id = c.id AND il.is_default AND il.deleted_at IS NULL)
             ORDER BY c.name LIMIT 1`);
        COMPANY = comp.id;
        [central] = await q(`SELECT id, name FROM inventory_locations
                              WHERE company_id = :c AND is_default AND deleted_at IS NULL`, { c: COMPANY });
        // Dos usuarios distintos: uno será el encargado de la bodega de prueba, el otro un extraño.
        const usuarios = await q(`SELECT user_id id FROM user_companies
                                   WHERE company_id = :c AND status = 'active' LIMIT 2`, { c: COMPANY });
        const encargado = usuarios[0].id;
        const extrano = (usuarios[1] || usuarios[0]).id;

        const miBodega = await inventory_locations.create({
            company_id: COMPANY, name: 'ZZZ Camion del vendedor', type: 'movil',
            status: 'abierta', is_default: false, is_active: true, user_id: encargado,
        });
        bodegasCreadas.push(miBodega.id);

        const [p] = await q(`
            INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
            VALUES (:c, 'ZZZ Producto mi bodega', 'TEST-MIBOD', 1000, 400, 0, true, now(), now()) RETURNING id`,
            { c: COMPANY });
        prodsCreados.push(p.id);
        await exec(`INSERT INTO product_stock_movements
                        (company_id, product_id, location_id, quantity_change, movement_type, reference_type, description, created_at)
                    VALUES (:c, :p, :l, 50, 'ENTRADA', 'manual', 'carga de prueba mi bodega', now())`,
            { c: COMPANY, p: p.id, l: central.id });

        /** Un usuario cualquiera, con los permisos que se le indiquen. */
        const como = (id, permisos = [], tipo = 'collaborator') =>
            ({ id, companyId: COMPANY, userType: tipo, permissions: permisos });

        const verSaldos = async (user, locationId) => {
            const r = res();
            await stockCtrl.getBalancesByLocation({ user, params: { locationId: String(locationId) }, query: {} }, r);
            return r;
        };

        // ── 1 ────────────────────────────────────────────────────────────────────
        titulo('1) 🔴 El vendedor ve SU bodega, y NO la de nadie más');
        let r = await verSaldos(como(encargado), miBodega.id);
        ok(r._c === 200, `el encargado lee su propia bodega → ${r._c}`);

        r = await verSaldos(como(encargado), central.id);
        ok(r._c === 403, `y la CENTRAL se la niega → ${r._c}`);
        ok(/bodegas de las que eres responsable/i.test((r._p && r._p.message) || ''),
            `con un mensaje que explica por qué: "${r._p && r._p.message}"`);

        if (extrano !== encargado) {
            r = await verSaldos(como(extrano), miBodega.id);
            ok(r._c === 403, `y otro usuario sin permiso tampoco entra a la del vendedor → ${r._c}`);
        }

        // ── 2 ────────────────────────────────────────────────────────────────────
        titulo('2) Quien SÍ tiene el permiso global sigue viéndolo todo');
        r = await verSaldos(como(extrano, ['view_products_stock']), miBodega.id);
        ok(r._c === 200, `con \`view_products_stock\` entra a cualquier bodega → ${r._c}`);
        r = await verSaldos(como(extrano, [], 'owner'), central.id);
        ok(r._c === 200, `y el owner también, sin permisos declarados → ${r._c}`);

        // ── 3 ────────────────────────────────────────────────────────────────────
        titulo('3) 🔴 El vendedor NO puede ajustar su bodega (solo recibe)');
        // `direction: 'in'` a propósito: así la prueba habla SOLO de autorización. Con 'out' sobre
        // una bodega vacía saltaría el 409 de stock insuficiente y no se sabría si el permiso se
        // comprobó o no. (El control de acceso corre ANTES que el de existencias, pero una prueba
        // que depende de ese orden se rompe el día que alguien lo cambie.)
        const ajustar = async (user, locationId) => {
            const rr = res();
            await stockCtrl.adjustLocationStock({
                user, params: { locationId: String(locationId) },
                body: { product_id: p.id, quantity: 1, direction: 'in', description: 'prueba' },
            }, rr);
            return rr;
        };
        r = await ajustar(como(encargado), miBodega.id);
        ok(r._c === 403, `el encargado NO puede ajustar la suya → ${r._c}`);
        ok(!/solo su responsable/i.test((r._p && r._p.message) || ''),
            'y el mensaje ya no dice que el responsable pueda (decía lo contrario de lo que hace)');

        r = await ajustar(como(extrano, ['create_products_stock']), miBodega.id);
        ok(r._c === 201 || r._c === 200, `quien tiene \`create_products_stock\` sí ajusta → ${r._c}`);

        // ── 4 ────────────────────────────────────────────────────────────────────
        titulo('4) Pero RECIBIR sigue siendo suyo: eso no se le quitó');
        // Se mide el ANTES y el DESPUÉS en vez de un número fijo: la sección 3 dejó una unidad
        // suelta en esta bodega, y una aserción absoluta se rompería por lo que hizo otra prueba.
        const saldoDe = async () => {
            const [f] = await q(`SELECT balance::float8 b FROM product_stock_balances
                                  WHERE product_id = :p AND location_id = :l`, { p: p.id, l: miBodega.id });
            return f ? f.b : 0;
        };
        const antesDeRecibir = await saldoDe();
        r = res();
        await traspasosCtrl.createTransfer({
            user: como(extrano, ['create_transfer']),
            body: { from_location_id: central.id, to_location_id: miBodega.id, items: [{ product_id: p.id, quantity: 10 }] },
        }, r);
        ok(r._c === 201, `se le emite un traspaso → ${r._c}`);
        const trId = r._p.transfer.id; traspasosCreados.push(trId);
        const [it] = await q(`SELECT id FROM stock_transfer_items WHERE transfer_id = :t`, { t: trId });

        r = res();
        await traspasosCtrl.receiveTransfer({
            user: como(encargado),          // SIN un solo permiso
            params: { id: String(trId) },
            body: { items: [{ item_id: it.id, received_quantity: 10 }] },
        }, r);
        ok(r._c === 200, `y el encargado lo recibe SIN permisos → ${r._c}`);

        const despuesDeRecibir = await saldoDe();
        ok(despuesDeRecibir - antesDeRecibir === 10,
            `la mercancía entró a su bodega: ${antesDeRecibir} → ${despuesDeRecibir}`);

        r = await verSaldos(como(encargado), miBodega.id);
        ok(r._c === 200 && Array.isArray(r._p.balances) && r._p.balances.length === 1,
            'y ahora la ve en su pantalla de "Mi bodega"');

        // ── 5 ────────────────────────────────────────────────────────────────────
        titulo('5) La migración sembró el submódulo, su permiso y el rol');
        const [sub] = await q(`SELECT s.code, s.route_path, s.is_active, m.code modulo
                                 FROM submodules s JOIN modules m ON m.id = s.module_id
                                WHERE s.code = 'my-warehouse'`);
        ok(!!sub, 'existe el submódulo `my-warehouse`');
        ok(sub && sub.modulo === 'delivery', `cuelga del módulo delivery (${sub && sub.modulo})`);
        ok(sub && sub.is_active === true, 'y nace activo');

        const [perm] = await q(`SELECT p.code FROM permissions p JOIN submodules s ON s.id = p.submodule_id
                                 WHERE s.code = 'my-warehouse'`);
        ok(perm && perm.code === 'view_own_warehouse', `con su permiso de lectura (${perm && perm.code})`);

        const roles = await q(`SELECT r.name, r.is_global FROM role_permissions rp
                                 JOIN roles r ON r.id = rp.role_id
                                 JOIN permissions p ON p.id = rp.permission_id
                                WHERE p.code = 'view_own_warehouse' ORDER BY r.name`);
        ok(roles.length === 1 && roles[0].name === 'SELLER' && roles[0].is_global === true,
            `otorgado SOLO al rol global SELLER (${roles.map((x) => x.name).join(', ') || 'ninguno'})`);
        ok(!roles.some((x) => x.name === 'OWNER' || x.name === 'ADMIN'),
            'y NO a OWNER/ADMIN: ellos ya ven todas las bodegas desde INVENTARIOS');

        // ── 6 ────────────────────────────────────────────────────────────────────
        titulo('6) 🔴 Los códigos que pregunta el FRONTEND existen de verdad');
        if (!fs.existsSync(path.join(RAIZ_CLIENT, 'src'))) {
            ok(false, 'no se encontró el código del cliente; esta sección NO se pudo comprobar');
        } else {
            const codigosEnBd = new Set((await q(`SELECT code FROM submodules`)).map((s) => s.code));
            const permisosEnBd = new Set((await q(`SELECT code FROM permissions`)).map((p) => p.code));

            const pedidosSub = new Map();     // submódulo -> archivo donde se pide
            const pedidosPerm = new Map();
            const reSub = /hasSubmodulePermission\(\s*[^,]+,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
            const reEsp = /hasSpecificPermission\(\s*[^,]+,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;

            for (const archivo of fuentesDelCliente(path.join(RAIZ_CLIENT, 'src'))) {
                const texto = fs.readFileSync(archivo, 'utf8');
                const corto = path.relative(RAIZ_CLIENT, archivo).replace(/\\/g, '/');
                let m;
                while ((m = reSub.exec(texto)) !== null) if (!pedidosSub.has(m[2])) pedidosSub.set(m[2], corto);
                while ((m = reEsp.exec(texto)) !== null) {
                    if (!pedidosSub.has(m[2])) pedidosSub.set(m[2], corto);
                    if (!pedidosPerm.has(m[3])) pedidosPerm.set(m[3], corto);
                }
            }

            ok(pedidosSub.size > 0, `se encontraron ${pedidosSub.size} códigos de submódulo en el cliente`);
            const subHuerfanos = [...pedidosSub].filter(([c]) => !codigosEnBd.has(c));
            ok(subHuerfanos.length === 0,
                subHuerfanos.length === 0
                    ? 'TODOS existen en la tabla `submodules` (el menú se puede pintar)'
                    : `hay ${subHuerfanos.length} que NO existen → su menú nunca aparece: ${subHuerfanos.map(([c, f]) => `"${c}" (${f})`).join(', ')}`);

            const permHuerfanos = [...pedidosPerm].filter(([c]) => !permisosEnBd.has(c));
            ok(permHuerfanos.length === 0,
                permHuerfanos.length === 0
                    ? 'y todos los permisos que consulta existen en `permissions`'
                    : `hay ${permHuerfanos.length} permisos inexistentes: ${permHuerfanos.map(([c, f]) => `"${c}" (${f})`).join(', ')}`);

            ok(pedidosSub.has('my-warehouse'), 'el cliente pregunta por `my-warehouse` (si no, el item no se pinta)');
            ok(pedidosSub.has('tracking'), 'y por `tracking` — el código real, no `view-tracking`');
            ok(!pedidosSub.has('view-tracking') && !pedidosSub.has('users-ubications'),
                'ya no quedan las grafías viejas que no existían en la base');
        }

    } finally {
        for (const t of traspasosCreados) {
            await product_stock_movements.destroy({ where: { reference_type: 'stock_transfer', reference_id: t } });
            await stock_transfer_items.destroy({ where: { transfer_id: t }, force: true });
            await stock_transfers.destroy({ where: { id: t }, force: true, userId: 'limpieza' });
        }
        for (const p of prodsCreados) {
            await exec(`DELETE FROM product_stock_movements WHERE product_id = :p`, { p });
            await exec(`DELETE FROM product_stock_balances WHERE product_id = :p`, { p });
            await products.destroy({ where: { id: p }, force: true });
        }
        for (const b of bodegasCreadas) await inventory_locations.destroy({ where: { id: b }, force: true });
        const [sobras] = await q(`SELECT (SELECT count(*)::int FROM products WHERE sku = 'TEST-MIBOD') p,
                                         (SELECT count(*)::int FROM inventory_locations WHERE name LIKE 'ZZZ Camion del vendedor%') b`);
        console.log(`\n🧹 Limpieza: ${traspasosCreados.length} traspasos, ${prodsCreados.length} productos, ${bodegasCreadas.length} bodegas · sobras: ${sobras.p}/${sobras.b}`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
