require('./_guardia-bd');   // ⚠️ ESTA PRUEBA ESCRIBE EN LA BASE DE DATOS

/* ─────────────────────────────────────────────────────────────────────────────
 * Raíces del monorepo, resueltas desde DONDE ESTÁ ESTE ARCHIVO.
 * Antes iban escritas a mano (`c:/Proyectos/...`) y la prueba solo corría en
 * una máquina y en una ruta. Si mueves esta carpeta, ajusta el `resolve`.
 * ───────────────────────────────────────────────────────────────────────────── */
const RAIZ_SERVER = require('path').resolve(__dirname, '..');

// Prueba del controlador de Configuraciones. Deja la compañía como estaba.
const { sequelize, companies } = require(RAIZ_SERVER + '/src/models');
sequelize.options.logging = false;
const ctrl = require(RAIZ_SERVER + '/src/controllers/company_settings_controller.js');

const COMPANY = '1f41ae80-e91b-401f-8dc4-8b78b9662311';
const res = () => ({ _c: 200, status(c) { this._c = c; return this; }, json(p) { this._p = p; return this; } });
let fallos = 0;
const ok = (c, m) => { if (!c) fallos++; console.log(`${c ? '  OK  ' : ' FALLA'} · ${m}`); };
const owner = { id: '0', companyId: COMPANY, userType: 'owner', permissions: [] };

(async () => {
    const original = (await companies.findByPk(COMPANY)).sales_inventory_mode;
    try {
        let r = res(); await ctrl.getCompanySettings({ user: owner }, r);
        ok(r._c === 200 && r._p.settings.sales_inventory_mode === original, `GET → ${r._c} · modo actual "${r._p.settings?.sales_inventory_mode}"`);

        for (const modo of ['descuenta_bodegas', 'descuenta_central', 'sin_inventario']) {
            r = res(); await ctrl.updateCompanySettings({ user: owner, body: { sales_inventory_mode: modo } }, r);
            const enBd = (await companies.findByPk(COMPANY)).sales_inventory_mode;
            ok(r._c === 200 && r._p.settings.sales_inventory_mode === modo && enBd === modo, `PUT "${modo}" → ${r._c} y persiste en BD`);
        }

        r = res(); await ctrl.updateCompanySettings({ user: owner, body: { sales_inventory_mode: 'lo_que_sea' } }, r);
        ok(r._c === 400, `PUT con modo inválido → ${r._c} · "${r._p.message}"`);

        r = res(); await ctrl.updateCompanySettings({ user: owner, body: {} }, r);
        ok(r._c === 400, `PUT sin cambios → ${r._c} · "${r._p.message}"`);

        r = res(); await ctrl.updateCompanySettings({ user: owner, body: { sales_inventory_mode: null } }, r);
        ok(r._c === 400, `PUT con null → ${r._c} (no borra el valor)`);

        r = res(); await ctrl.getCompanySettings({ user: { ...owner, companyId: '00000000-0000-0000-0000-000000000000' } }, r);
        ok(r._c === 404, `GET de una compañía inexistente → ${r._c}`);

        // Aislamiento: cambiar una compañía no toca a las demás.
        const otras = await sequelize.query(
            `SELECT count(*)::int n FROM companies WHERE id <> :c AND sales_inventory_mode <> 'sin_inventario'`,
            { type: sequelize.QueryTypes.SELECT, replacements: { c: COMPANY } });
        ok(otras[0].n === 0, 'las demás compañías siguen en "sin_inventario" (sin fugas entre tenants)');
    } finally {
        await companies.update({ sales_inventory_mode: original }, { where: { id: COMPANY } });
        console.log(`\n🧹 Modo restaurado a "${original}".`);
        console.log(fallos === 0 ? '\n✅ TODO OK' : `\n❌ ${fallos} fallo(s)`);
        await sequelize.close();
        process.exit(fallos === 0 ? 0 : 1);
    }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
