require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// ¿La fila de saldo sobrevive cuando el producto se agota? De eso depende que "solo lo que ha
// recibido la bodega, incluido lo agotado" se pueda listar desde product_stock_balances.
const { sequelize, products, inventory_locations } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });
const exec = (s, r) => sequelize.query(s, { replacements: r });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };

(async () => {
    let prod = null, bodega = null;
    try {
        const [comp] = await q(`SELECT id FROM companies WHERE EXISTS (SELECT 1 FROM inventory_locations il WHERE il.company_id=companies.id AND il.is_default) LIMIT 1`);
        const [p] = await q(`
            INSERT INTO products (company_id, name, sku, sale_price, production_cost, min_stock, is_active, created_at, updated_at)
            VALUES (:c, 'ZZZ Prueba fila cero', 'TEST-FILACERO', 1000, 400, 0, true, now(), now()) RETURNING id`, { c: comp.id });
        prod = p.id;
        bodega = (await inventory_locations.create({
            company_id: comp.id, name: 'ZZZ Camión prueba', type: 'movil', status: 'abierta', is_default: false, is_active: true,
        })).id;

        const filas = async () => q(`SELECT balance::float8 b FROM product_stock_balances WHERE product_id=:p AND location_id=:l`, { p: prod, l: bodega });
        ok((await filas()).length === 0, 'antes de recibir nada: la bodega NO tiene fila de ese producto (no lo mostraría)');

        // Entra por traspaso (así llega la mercancía al camión).
        await exec(`INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, created_at)
                    VALUES (:c, :p, :l, 10, 'TRASPASO_ENTRADA', 'stock_transfer', now())`, { c: comp.id, p: prod, l: bodega });
        let f = await filas();
        ok(f.length === 1 && f[0].b === 10, `tras recibir 10: aparece la fila con ${f[0]?.b}`);

        // Se vende todo.
        await exec(`INSERT INTO product_stock_movements (company_id, product_id, location_id, quantity_change, movement_type, reference_type, created_at)
                    VALUES (:c, :p, :l, -10, 'SALIDA', 'sale', now())`, { c: comp.id, p: prod, l: bodega });
        f = await filas();
        ok(f.length === 1 && f[0].b === 0, `tras vender las 10: la fila SIGUE existiendo, en ${f[0]?.b} → el vendedor ve "se me acabó"`);
    } finally {
        if (prod) {
            await exec(`DELETE FROM product_stock_movements WHERE product_id=:p`, { p: prod });
            await exec(`DELETE FROM product_stock_balances WHERE product_id=:p`, { p: prod });
            await products.destroy({ where: { id: prod }, force: true });
        }
        if (bodega) await inventory_locations.destroy({ where: { id: bodega }, force: true });
        console.log(`\n🧹 Limpieza hecha.`);
        console.log(fallos === 0 ? '✅ TODO OK' : `❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
