require('./_guardia-bd');

/**
 * DETALLE DE UNA VENTA — `GET /api/sales/detail/:sale_id`
 *
 * Ejercita el handler REAL contra la base local. No monta express: le pasa un `req`/`res` de
 * mentira, que es donde vive toda la logica que importa.
 *
 * 🔴 SOLO LEE. No crea, no borra, no toca la jornada de nadie. Aun asi lleva el guardia, porque
 * la regla de esta carpeta es que ninguna bateria decide por su cuenta contra que base corre.
 *
 * ⚠️ NO LLEVA IDENTIFICADORES FIJOS. Las muestras se BUSCAN en la base al arrancar: la venta mas
 * reciente con lineas, la mas antigua sin ellas, y una apartada si la hay. Con ids escritos a
 * mano, la bateria se vuelve mentira en cuanto se refresca la copia de produccion.
 */
const { sequelize } = require('../src/models');
const { QueryTypes } = require('sequelize');
const { salesReportsController } = require('../src/controllers');

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('   OK    ' + m); } else { fail++; console.log('   FALLA ' + m); } };
const omitido = (m) => console.log('   --    (omitida) ' + m);
const titulo = (t) => console.log('\n-- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

const una = async (sql) => {
    const filas = await sequelize.query(sql, { type: QueryTypes.SELECT });
    return filas[0] || null;
};

/** Llama al handler y devuelve lo que habria respondido express. */
async function pedir(saleId, companyId) {
    const req = { user: { companyId }, params: { sale_id: String(saleId) } };
    let codigo = 200, cuerpo = null;
    await salesReportsController.getSaleDetail(req, {
        status(c) { codigo = c; return this; },
        json(b) { cuerpo = b; return this; },
    });
    return { codigo, cuerpo };
}

(async () => {
    const empresa = await una(`SELECT company_id FROM sales LIMIT 1`);
    if (!empresa) {
        console.log('No hay ventas en esta base: nada que comprobar.');
        console.log('\n=== 0 OK · 0 FALLAS ===');
        await sequelize.close();
        process.exit(0);
    }
    const CID = empresa.company_id;
    const OTRA = '00000000-0000-0000-0000-000000000000';

    const conItems = await una(`SELECT s.id FROM sales s
        WHERE s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id)
        ORDER BY s.id DESC LIMIT 1`);
    const sinItems = await una(`SELECT s.id FROM sales s
        WHERE s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id)
        ORDER BY s.id LIMIT 1`);
    const apartada = await una(`SELECT s.id FROM sales s WHERE s.conflict_reason IS NOT NULL LIMIT 1`);

    titulo('1) Venta CON detalle de lineas');
    if (!conItems) {
        omitido('no hay ninguna venta con lineas en esta base');
    } else {
        const r = await pedir(conItems.id, CID);
        assert(r.codigo === 200, `responde 200 (dio ${r.codigo})`);
        assert(r.cuerpo?.data?.venta?.id === conItems.id, 'trae la venta pedida');
        const items = r.cuerpo?.data?.items || [];
        assert(items.length > 0, `trae sus lineas (${items.length})`);
        assert(typeof items[0]?.quantity === 'number' && typeof items[0]?.unit_price === 'number',
            'cantidades y precios son NUMEROS, no texto (son DECIMAL: sin cast llegarian como cadena)');
        assert(!('unit_cost' in (items[0] || {})),
            'y NO viaja `unit_cost`: es el margen del negocio y esto lo abre un vendedor');
        const suma = items.reduce((s, i) => s + i.total_price, 0);
        assert(Math.abs(suma - r.cuerpo.data.venta.total_amount) < 1,
            `las lineas cuadran con el total (${suma} vs ${r.cuerpo.data.venta.total_amount})`);
        const v = r.cuerpo.data.venta;
        assert(!!v.store_name && !!v.vendedor && !!v.payment_method,
            'trae tienda, vendedor y forma de pago (lo que necesita el cajon y el ticket)');
    }

    titulo('2) 🔴 Venta ANTIGUA sin detalle: NO es un error');
    if (!sinItems) {
        omitido('todas las ventas de esta base tienen lineas');
    } else {
        const r = await pedir(sinItems.id, CID);
        assert(r.codigo === 200, `responde 200, no un error (dio ${r.codigo})`);
        assert(Array.isArray(r.cuerpo?.data?.items) && r.cuerpo.data.items.length === 0,
            '`items` llega vacio: su detalle nunca existio (se registro antes de agosto de 2026)');
        assert(r.cuerpo?.data?.venta?.total_amount > 0,
            'pero la cabecera SI trae el importe que se cobro');
    }

    titulo('3) 🔴 Venta APARTADA: se devuelve a proposito, y marcada');
    if (!apartada) {
        omitido('no hay ventas apartadas en esta base');
    } else {
        const r = await pedir(apartada.id, CID);
        assert(r.codigo === 200, `responde 200 aunque nace con \`deleted_at\` (dio ${r.codigo})`);
        assert(r.cuerpo?.data?.venta?.apartada === true, 'viene marcada como apartada');
        assert(!!r.cuerpo?.data?.venta?.conflict_reason,
            'y con el motivo: el vendedor ya cobro ese dinero y alguien tiene que cuadrarlo');
    }

    titulo('4) Aislamiento multi-tenant');
    if (conItems) {
        const ajena = await pedir(conItems.id, OTRA);
        const inexistente = await pedir(999999999, CID);
        assert(ajena.codigo === 404, `otra compañia no la ve (dio ${ajena.codigo})`);
        assert(ajena.cuerpo?.message === inexistente.cuerpo?.message,
            'y el 404 es IDENTICO al de una venta inexistente: no se pueden sondear ids probando');
    }

    titulo('5) Identificadores invalidos');
    for (const malo of ['abc', '-5', '0', '1.5', '', '1e3', ' 1']) {
        const r = await pedir(malo, CID);
        assert(r.codigo === 400, `"${malo}" -> 400`);
    }
    console.log('       ⚠️ "1.5" importa: `parseInt` lo trunca a 1, y devolvia la venta 1 tan tranquila.');

    console.log(`\n=== ${ok} OK · ${fail} FALLAS ===`);
    await sequelize.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message, e.stack); process.exit(1); });
