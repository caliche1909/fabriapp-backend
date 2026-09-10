const {
    sales: Sales,
    stores: Stores,
    store_no_sale_reports,
    store_visits: StoreVisits,
    sale_items: SaleItems,
    products: Products,
    inventory_locations: InventoryLocations,
    product_stock_movements: ProductStockMovements,
    product_stock_balances: ProductStockBalances,
} = require('../models');
const { Op } = require('sequelize');
const { autorizarSobreLaVisita } = require('../utils/storeVisits');
const {
    CODIGOS, leerCamposDeSincronizacion, buscarOperacionPrevia, esChoqueDeIdempotencia,
} = require('../utils/sincronizacion');

/**
 * 🛒 CONTROLADOR DE VENTAS
 *
 * El comportamiento depende del MODO de la compañía (`companies.sales_inventory_mode`, que se
 * elige en Configuraciones y llega en cada request vía `req.user.companySalesInventoryMode`):
 *
 *   - `sin_inventario`     → se vende del CATÁLOGO y la venta NO toca el stock (sin bodega).
 *   - `descuenta_central`  → se vende del catálogo y se descuenta de la bodega CENTRAL.
 *   - `descuenta_bodegas`  → cada vendedor vende y descuenta de SU bodega (de la que es responsable).
 *
 * El modo se lee SIEMPRE de la sesión, nunca del cliente.
 */

const num = (v) => (v != null ? parseFloat(v) : 0);

// Margen (%) = round((venta - costo) / venta * 100). NULL si falta venta o costo (misma regla que
// el resto del módulo de stock, para que los números cuadren en toda la app).
const computeMargin = (salePrice, cost) => {
    if (!salePrice || !cost) return null;
    return Math.round(((salePrice - cost) / salePrice) * 100);
};

// 🏬 Bodega utilizable: viva, activa y abierta. Misma regla al listar y al vender.
const bodegaOperativa = (loc) => Boolean(loc && loc.is_active && loc.status === 'abierta');

/**
 * 📋 Productos que el vendedor puede ofrecer, con su existencia.
 *
 * Hay DOS orígenes posibles para la lista, según de dónde salga la mercancía:
 *
 *   - **Lo que la bodega ha recibido** (`soloLoRecibido`, modo `descuenta_bodegas`): la lista son
 *     las filas de saldo de ESA bodega. Una bodega se surte por traspaso, y la fila de saldo nace
 *     con el primer traspaso y **ya no desaparece**: cuando el producto se agota queda en 0. Por eso
 *     el vendedor ve exactamente lo que le entregaron —incluido lo que se le acabó, para que sepa
 *     que debe pedir más para la próxima jornada— y NO el catálogo entero de la compañía, que en un
 *     camión sería una lista larguísima de productos que nunca carga.
 *
 *   - **El CATÁLOGO de la compañía** (resto de modos): sin inventario no hay bodega contra la que
 *     medir, así que el catálogo es la única respuesta posible. La existencia, si hay bodega, se
 *     pega con un LEFT JOIN.
 *
 * Reglas comunes:
 *   - Fuera los productos SIN precio: la línea sumaría 0 y la venta se rechazaría por "el total debe
 *     ser mayor que 0". Es un producto a medio configurar, no algo vendible.
 *   - Fuera los INACTIVOS... salvo que tengan existencias ahí: si el vendedor lleva físicamente
 *     mercancía descontinuada, tiene que poder liquidarla.
 *
 * Se devuelve SOLO lo que el POS pinta (nombre, precio, presentación y existencia).
 *
 * @param {number|null} locationId      Bodega de la que sale la mercancía. `null` = sin inventario
 *                                      → `disponible` sale null (sin tope de cantidad).
 * @param {boolean} opts.soloLoRecibido true = listar únicamente lo que esa bodega tiene o ha tenido.
 */
async function listarProductosVendibles(company_id, locationId, { soloLoRecibido = false } = {}) {
    const CAMPOS = `p.id AS product_id, p.name, p.sale_price::float8 AS sale_price,
                    pr.id AS presentation_id, pr.name AS presentation_name`;

    // Lo que la bodega tiene o ha tenido: se parte de sus saldos (INNER JOIN), no del catálogo.
    const SQL_BODEGA = `
        SELECT ${CAMPOS}, b.balance::float8 AS disponible
          FROM product_stock_balances b
          JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
          LEFT JOIN product_presentations pr ON pr.id = p.presentation_id
         WHERE b.location_id = CAST(:loc AS integer)
           AND p.company_id = :company
           AND p.sale_price > 0
           AND (p.is_active OR b.balance > 0)
         ORDER BY p.name ASC`;

    // Todo el catálogo, con la existencia al lado si hay bodega contra la que medirla.
    const SQL_CATALOGO = `
        SELECT ${CAMPOS}, COALESCE(b.balance, 0)::float8 AS disponible
          FROM products p
          LEFT JOIN product_stock_balances b ON b.product_id = p.id
                                            AND b.location_id = CAST(:loc AS integer)
          LEFT JOIN product_presentations pr ON pr.id = p.presentation_id
         WHERE p.company_id = :company
           AND p.deleted_at IS NULL
           AND p.sale_price > 0
           AND (p.is_active OR COALESCE(b.balance, 0) > 0)
         ORDER BY p.name ASC`;

    const filas = await Sales.sequelize.query(
        (locationId && soloLoRecibido) ? SQL_BODEGA : SQL_CATALOGO,
        { replacements: { company: company_id, loc: locationId }, type: Sales.sequelize.QueryTypes.SELECT }
    );

    return filas.map((f) => ({
        product_id: f.product_id,
        name: f.name,
        sale_price: num(f.sale_price),
        presentation: f.presentation_id ? { id: f.presentation_id, name: f.presentation_name } : null,
        // Sin bodega no hay existencia que mostrar ni tope que aplicar.
        disponible: locationId ? num(f.disponible) : null,
    }));
}

module.exports = {
    /**
     * 📝 Crear una nueva venta (Punto de Venta con lista de productos).
     *
     * El efecto sobre el stock depende del MODO de la compañía (ver cabecera del archivo):
     *   - `descuenta_bodegas` → cada ítem genera una SALIDA en la BODEGA DEL VENDEDOR (el trigger
     *     descuenta el saldo y rechaza si no alcanza). La venta guarda esa bodega en `location_id`.
     *   - `sin_inventario`    → NO se busca bodega, NO se valida stock y NO se crean movimientos:
     *     la venta queda con `location_id` NULL. Todo lo demás (totales, snapshots, visita) es igual.
     *
     * Se permiten VARIAS ventas por visita (append-only): la visita acumula el monto (`sale_amount`).
     *
     * Seguridad/integridad:
     *   - Multi-tenant: todo scoped por `req.user.companyId`; la tienda y la visita se validan.
     *   - El MODO y la BODEGA se derivan en el SERVIDOR, nunca del cliente.
     *   - Los SNAPSHOTS (nombre, precio de venta, costo de producción) y los TOTALES se calculan/estampan
     *     en el servidor desde el producto; el cliente solo manda { product_id, quantity }.
     *   - TODO en una transacción; el trigger de stock es el guardián atómico anti-negativo (409).
     *
     * Body: { store_id, payment_method_id, route_id?, visit_id?, items: [{ product_id, quantity }] }
     */
    async createSale(req, res) {
        const company_id = req.user.companyId;
        const user_id = req.user.id;

        // 🔁 CONTRATO DE SINCRONIZACIÓN — se resuelve ANTES de abrir la transacción.
        //
        // 🔴 Esta es la protección más importante de todo el módulo. `createSale` admite varias
        // ventas por visita **a propósito** (el vendedor puede volver a venderle a la misma tienda)
        // y **suma** el monto a la parada. Sin una clave que identifique "esta venta concreta", un
        // reintento tras una respuesta perdida —mala cobertura, timeout de 30 s del cliente, o dos
        // toques en el botón— crea una SEGUNDA VENTA BUENA: doble stock descontado y el Cuadre
        // descuadrado, en silencio. Con el uuid, el reintento devuelve la venta que ya existe.
        const sync = leerCamposDeSincronizacion(req.body);
        if (!sync.ok) {
            return res.status(400).json({
                success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS, message: sync.message,
            });
        }

        if (sync.clientOperationId) {
            // ⚠️ `buscarOperacionPrevia` va con `paranoid: false` a propósito: una venta ANULADA
            // sigue ocupando su uuid en el índice único aunque el findOne normal no la vea. Sin
            // esto, reintentar una venta anulada no la encontraría, intentaría insertar y chocaría
            // con el índice devolviendo un 500.
            const previa = await buscarOperacionPrevia(Sales, sync.clientOperationId);
            if (previa) {
                if (previa.company_id !== company_id) {
                    return res.status(409).json({
                        success: false, status: 409, code: CODIGOS.DATOS_INVALIDOS,
                        message: 'Ese identificador de operación ya se usó en otra compañía.',
                    });
                }
                const total = num(previa.total_amount);
                const itemCount = await SaleItems.count({ where: { sale_id: previa.id } });
                const visita = previa.visit_id
                    ? await StoreVisits.findOne({ where: { id: previa.visit_id }, attributes: ['sale_amount'] })
                    : null;
                // 🧾 Si la primera vez quedó APARTADA, el reintento tiene que enterarse de lo
                // mismo. Con `YA_REGISTRADO` a secas, el teléfono la daría por buena y se quedaría
                // enseñando la parada cerrada con un importe que no cuenta.
                const apartada = Boolean(previa.conflict_reason);
                return res.status(200).json({
                    success: true, status: 200,
                    code: apartada ? CODIGOS.REGISTRADA_CON_CONFLICTO : CODIGOS.YA_REGISTRADO,
                    message: apartada ? previa.conflict_reason : 'Esta venta ya estaba registrada.',
                    data: {
                        id: previa.id,
                        total_amount: total,
                        item_count: itemCount,
                        location_id: previa.location_id,
                        visit_sale_amount: apartada ? null : (visita ? num(visita.sale_amount) : null),
                        anulada: Boolean(previa.deleted_at) || previa.status === 'voided',
                        ...(apartada ? { conflict_reason: previa.conflict_reason } : {}),
                    },
                });
            }
        }

        const t = await Sales.sequelize.transaction();
        try {
            const { store_id, payment_method_id, route_id, visit_id, items } = req.body;

            // 1) Validaciones básicas.
            if (!store_id || !payment_method_id) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS, message: 'Faltan datos obligatorios (tienda y método de pago).' });
            }
            if (!Array.isArray(items) || items.length === 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Debes agregar al menos un producto a la venta.' });
            }

            // 2) La tienda debe pertenecer a la compañía (cierra IDOR).
            const storeInCompany = await Stores.findOne({ where: { id: store_id, company_id }, transaction: t });
            if (!storeInCompany) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La tienda no existe o no pertenece a tu compañía.' });
            }

            // 3) Bodega de la que sale la mercancía, SEGÚN EL MODO de la compañía.
            //    `location = null` significa "esta venta no toca el inventario" (modo sin_inventario):
            //    a partir de aquí, cada paso que mueve stock se salta si no hay bodega.
            const mode = req.user.companySalesInventoryMode || 'sin_inventario';
            let location = null;

            if (mode === 'descuenta_bodegas') {
                // La bodega del vendedor (derivada en el SERVIDOR). Debe existir, estar activa y abierta.
                location = await InventoryLocations.findOne({ where: { company_id, user_id }, transaction: t });
                if (!location) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, code: CODIGOS.SIN_BODEGA, message: 'No tienes una bodega asignada para vender. Comunícate con tu supervisor para que te asigne una.' });
                }
                if (!bodegaOperativa(location)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, code: CODIGOS.BODEGA_NO_OPERATIVA, message: 'Tu bodega está inactiva o cerrada; no puedes vender desde ella.' });
                }
            } else if (mode === 'descuenta_central') {
                // La bodega CENTRAL de la compañía: todos venden de la misma y NO hace falta ser
                // responsable de ninguna bodega (ese es el sentido de este modo).
                location = await InventoryLocations.findOne({ where: { company_id, is_default: true }, transaction: t });
                if (!location) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, code: CODIGOS.SIN_BODEGA, message: 'Tu compañía no tiene una bodega principal configurada; no se puede registrar la venta.' });
                }
                if (!bodegaOperativa(location)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, code: CODIGOS.BODEGA_NO_OPERATIVA, message: 'La bodega principal está inactiva o cerrada; no se puede vender desde ella.' });
                }
            }

            // 4) Si la venta va ligada a una visita: el vendedor debe ser el ENCARGADO ACTUAL de
            //    la ruta de esa visita, la visita debe ser de ESTA tienda, y no puede haber ya un
            //    reporte de no-venta.
            //
            //    ⚠️ Ya NO se busca la visita por `user_id`. Tras un relevo, la parada puede seguir a
            //    nombre del vendedor anterior (fue él quien llegó) y aun así el nuevo encargado debe
            //    poder cerrarla con la venta. Quién vendió queda registrado en `sales.user_id`.
            //
            //    Si la venta NO trae `visit_id` no hay jornada de por medio (venta suelta desde
            //    Gestión de tiendas): se deja como estaba, sin regla de ruta.
            //    🧾 VENTAS QUE YA NO CABEN — se guardan APARTADAS en vez de perderse.
            //
            //    🔴 EL CASO REAL: el vendedor vendió sin señal y cobró. Horas después, al
            //    sincronizar, resulta que esa parada se cerró con un reporte de no compra, o que
            //    reasignaron la ruta. Rechazar la venta la borraría del mundo: el dinero cambió de
            //    manos y no quedaría rastro en ninguna parte.
            //
            //    Por eso estos conflictos ya no cortan: se anotan en `conflicto` y la venta se
            //    crea igual, con `deleted_at` puesto (queda fuera de TODOS los informes) y el
            //    motivo en `conflict_reason`, para que el supervisor pueda verla y actuar.
            //
            //    ⚠️ LA RAYA. Solo se apartan los conflictos de NEGOCIO sobre la visita. Los fallos
            //    de validación y de pertenencia se siguen rechazando: guardar basura apartada es
            //    peor que rechazarla, y aceptar una escritura que no debería existir es abrir una
            //    puerta. Ver `OFFLINE-CAMPO.md` §11.5.
            let conflicto = null;                 // { code, message } o null
            let visitaLigada = visit_id || null;  // se suelta si la visita ya no existe

            if (visit_id) {
                const laVisita = await StoreVisits.findOne({ where: { id: visit_id }, transaction: t });
                if (!laVisita) {
                    // Se aparta y se SUELTA de la visita: si la parada ya no existe, dejar el
                    // `visit_id` apuntando a nada rompería la clave foránea.
                    conflicto = { code: CODIGOS.VISITA_NO_EXISTE, message: 'La visita indicada ya no existe; la venta se guardó como incidencia.' };
                    visitaLigada = null;
                } else if (laVisita.store_id !== parseInt(store_id, 10)) {
                    // ❌ NO se aparta: esto no es un conflicto, es una petición mal formada.
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS, message: 'La visita indicada no corresponde a esta tienda.' });
                } else {
                    const permiso = await autorizarSobreLaVisita({ visita: laVisita, companyId: company_id, userId: user_id, transaction: t });
                    if (!permiso.autorizado) {
                        conflicto = { code: CODIGOS.NO_ES_ENCARGADO, message: `${permiso.mensaje} La venta se guardó como incidencia.` };
                    } else {
                        const existingNoSale = await store_no_sale_reports.findOne({ where: { visit_id }, transaction: t });
                        if (existingNoSale) {
                            conflicto = { code: CODIGOS.NO_VENTA_YA_REGISTRADA, message: 'Esa parada ya se había cerrado con un reporte de no compra; la venta se guardó como incidencia.' };
                        }
                    }
                }
            }

            // 5) Normalizar ítems: cantidades > 0, agregando por producto (por si llega repetido).
            const qtyByProduct = new Map();
            for (const it of items) {
                const pid = parseInt(it.product_id, 10);
                const q = num(it.quantity);
                if (!Number.isInteger(pid) || pid <= 0 || !(q > 0)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Cada ítem debe tener un producto válido y una cantidad mayor que 0.' });
                }
                qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + q);
            }
            const productIds = [...qtyByProduct.keys()];

            // 6) Traer los productos de la compañía (para snapshots). Todos deben existir.
            const prods = await Products.findAll({ where: { id: { [Op.in]: productIds }, company_id }, transaction: t });
            if (prods.length !== productIds.length) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Alguno de los productos no existe o no pertenece a tu compañía.' });
            }
            const prodById = new Map(prods.map((p) => [p.id, p]));

            // 6b) Sin inventario, el CATÁLOGO es el único filtro de lo vendible: aquí el guardián es
            //     `is_active` (con bodega, el guardián es tener existencias). Evita que un POS abierto
            //     desde antes —o una petición armada a mano— venda un producto ya descontinuado.
            //
            //     Descontinuar un producto DESPUÉS de venderlo también aparta la venta en vez de
            //     perderla: el vendedor lo entregó y lo cobró. La contrapartida es que un vendedor
            //     con señal y el POS abierto de antes recibe "quedó como incidencia" en vez de
            //     "ese producto ya no está" — un mensaje peor, pero no se pierde dinero. Entre las
            //     dos equivocaciones posibles, esta es la barata.
            if (!location && !conflicto) {
                const inactivo = prods.find((p) => !p.is_active);
                if (inactivo) {
                    conflicto = {
                        code: CODIGOS.PRODUCTO_NO_DISPONIBLE,
                        message: `El producto "${inactivo.name}" ya no está disponible para la venta; la venta se guardó como incidencia.`,
                    };
                }
            }

            // 7) Pre-chequeo de stock en la bodega (mensaje amigable). El trigger es el guardián real.
            //    Se salta cuando la venta no toca inventario (no hay saldo que consultar) y cuando
            //    la venta va apartada: esa no descuenta nada, así que no hay saldo que comprobar.
            if (location && !conflicto) {
                const balances = await ProductStockBalances.findAll({
                    where: { location_id: location.id, product_id: { [Op.in]: productIds } },
                    transaction: t,
                });
                const balById = new Map(balances.map((b) => [b.product_id, num(b.balance)]));
                for (const pid of productIds) {
                    const available = balById.get(pid) || 0;
                    const want = qtyByProduct.get(pid);
                    if (want > available) {
                        await t.rollback();
                        const p = prodById.get(pid);
                        return res.status(409).json({
                            success: false, status: 409, code: CODIGOS.STOCK_INSUFICIENTE,
                            message: `Stock insuficiente de "${p ? p.name : 'producto'}": disponible ${available}, intentas vender ${want}.`,
                        });
                    }
                }
            }

            // 8) Calcular totales en el SERVIDOR (en centavos, exacto). Snapshots desde el producto.
            const itemRows = [];
            let subtotalCents = 0;
            for (const pid of productIds) {
                const p = prodById.get(pid);
                const q = qtyByProduct.get(pid);
                const unitPrice = num(p.sale_price);                                    // snapshot precio de venta
                const unitCost = p.production_cost != null ? num(p.production_cost) : null; // snapshot costo (o null)
                const lineCents = Math.round(q * unitPrice * 100);
                subtotalCents += lineCents;
                itemRows.push({
                    product_id: pid,
                    product_name: p.name,
                    quantity: q,
                    unit_price: unitPrice,
                    unit_cost: unitCost,
                    total_price: lineCents / 100,
                });
            }
            const subtotal = subtotalCents / 100;
            const total = subtotal; // sin impuestos ni descuentos por ahora
            if (!(total > 0)) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'El total de la venta debe ser mayor que 0.' });
            }

            // 9) Crear la venta (cabecera).
            const newSale = await Sales.create({
                company_id,
                user_id,
                store_id,
                payment_method_id,
                location_id: location ? location.id : null, // NULL = la venta no salió de ninguna bodega

                subtotal,
                tax_amount: 0,
                discount_amount: 0,
                total_amount: total,
                route_id: route_id || null,
                visit_id: visitaLigada,   // se suelta si la visita ya no existe (ver el punto 4)
                status: 'completed',

                // 🧾 APARTADA. Nace con `deleted_at` puesto: eso es lo que la deja fuera de las 16
                // consultas que leen `sales` —todas filtran `deleted_at IS NULL`— sin tener que
                // tocar ni una de ellas.
                //
                // 🔴 Se pone en el INSERT, NO se borra después. Borrarla pasaría por el gancho
                // `beforeDestroy`, que exige un `options.userId` — y aquí no hay ninguno, porque
                // NADIE la borró: nació así. `deleted_by` se queda en NULL, que es lo correcto.
                //
                // `location_id` SÍ se conserva aunque no se mueva stock: documenta de qué bodega
                // debió salir la mercancía, que es justo lo que hará falta para cuadrarla.
                ...(conflicto ? { deleted_at: new Date(), conflict_reason: conflicto.message } : {}),

                // 🔁 Sincronización. `sale_date` es la fecha de NEGOCIO —la que filtran todos los
                // reportes y el Cuadre— así que es ahí donde va la hora real de la venta cuando el
                // cliente la declara. Sin esto, sincronizar en lote pondría las ventas de todo el
                // día a la misma hora de la tarde. (`created_at` no se puede fijar a mano en este
                // modelo, y está bien: se queda como la hora en que el servidor recibió la fila.)
                //
                // El spread es para NO mandar la clave cuando no hay hora declarada: así el
                // `defaultValue` del modelo (CURRENT_TIMESTAMP) entra sin depender de cómo trate
                // Sequelize un `undefined` explícito.
                ...(sync.occurredAt ? { sale_date: sync.occurredAt } : {}),
                client_operation_id: sync.clientOperationId,
                synced_at: sync.syncedAt,
            }, { transaction: t });

            // 10) Ítems + movimientos SALIDA (el trigger descuenta el saldo y protege < 0).
            //     El ítem de venta se guarda SIEMPRE —incluso apartada: **sin el detalle, la
            //     incidencia no le sirve de nada a quien tenga que cuadrarla**—; el movimiento de
            //     stock solo si hay bodega Y la venta no va apartada. Una venta que no cuenta no
            //     puede descontar existencias: sería restar stock por algo que no existe en los
            //     informes.
            for (const row of itemRows) {
                await SaleItems.create({
                    sale_id: newSale.id,
                    company_id,
                    product_id: row.product_id,
                    product_name: row.product_name,
                    quantity: row.quantity,
                    unit_price: row.unit_price,
                    unit_cost: row.unit_cost,
                    total_price: row.total_price,
                }, { transaction: t });

                if (location && !conflicto) {
                    await ProductStockMovements.create({
                        company_id,
                        product_id: row.product_id,
                        location_id: location.id,
                        quantity_change: -row.quantity, // SALIDA: negativo
                        movement_type: 'SALIDA',
                        unit_cost: row.unit_cost,
                        sale_price_snapshot: row.unit_price,
                        margin_snapshot: computeMargin(row.unit_price, row.unit_cost),
                        reference_type: 'sale',
                        reference_id: newSale.id,
                        user_id,
                    }, { transaction: t });
                }
            }

            // 11) Visita: acumular el monto vendido (varias ventas por visita) + marcar 'completed'.
            //     Se relee el `sale_amount` ACUMULADO para devolverlo (el front sincroniza su cache con él).
            //     ⚠️ El `user_id` SALIÓ del WHERE. Con él puesto, tras un relevo estos dos updates
            //     afectaban 0 filas EN SILENCIO: la venta quedaba registrada pero la visita no
            //     acumulaba el monto ni se cerraba. La autorización ya se hizo arriba por encargado.
            //
            //     El `user_id` de la parada NO se sobreescribe: sigue siendo quien LLEGÓ a la tienda.
            //     Quién vendió está en `sales.user_id`. Así el relevo no borra ningún dato: cada
            //     acción queda a nombre de quien la hizo, en su propia tabla.
            //
            //     🧾 Una venta APARTADA no toca la visita: ni suma su importe ni la cierra. Es la
            //     regla entera en una línea — **la parada tiene que seguir contando la verdad**, y
            //     esta venta no cuenta. (Si el conflicto era justamente que la parada ya se había
            //     cerrado con un reporte de no compra, sumarle el importe la descuadraría.)
            let visitSaleAmount = null;
            if (visit_id && !conflicto) {
                await StoreVisits.increment({ sale_amount: total }, { where: { id: visit_id }, transaction: t });
                await StoreVisits.update({ status: 'completed' }, { where: { id: visit_id }, transaction: t });
                const v = await StoreVisits.findOne({ where: { id: visit_id }, attributes: ['sale_amount'], transaction: t });
                visitSaleAmount = v ? num(v.sale_amount) : null;
            }

            await t.commit();

            // 🧾 Apartada: se responde 200 (no 201) y con un código propio.
            //
            // 🔴 ES UN ÉXITO PARA LA COLA Y UN AVISO PARA LA PANTALLA, a la vez. La operación está
            // en Postgres, que es la única condición para sacarla de la cola del teléfono; pero el
            // cliente tiene trabajo: devolver el stock que descontó (aquí no se movió ninguno),
            // recargar la ruta —la parada NO quedó cerrada con esta venta— y decírselo al vendedor
            // con otras palabras que un rechazo. Ver `OFFLINE-CAMPO.md` §11.7.
            if (conflicto) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    code: CODIGOS.REGISTRADA_CON_CONFLICTO,
                    message: conflicto.message,
                    data: {
                        id: newSale.id,
                        total_amount: total,
                        item_count: itemRows.length,
                        location_id: location ? location.id : null,
                        visit_sale_amount: null,      // no suma a la parada: no cuenta
                        conflict_reason: conflicto.message,
                        conflict_code: conflicto.code,
                    },
                });
            }

            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Venta registrada exitosamente',
                data: {
                    id: newSale.id,
                    total_amount: total,
                    item_count: itemRows.length,
                    location_id: location ? location.id : null,
                    visit_sale_amount: visitSaleAmount, // monto ACUMULADO de la visita (varias ventas)
                },
            });

        } catch (error) {
            await t.rollback();

            // 🔁 Carrera de idempotencia: dos peticiones idénticas a la vez (el vendedor toca dos
            // veces, o la cola reintenta mientras el primer envío seguía vivo). El SELECT de más
            // arriba no vio a la otra porque aún no había hecho commit, y el índice único frenó a
            // la segunda. La relectura va DESPUÉS del rollback y fuera de la transacción abortada:
            // en Postgres una sentencia fallida invalida la transacción entera y cualquier
            // consulta posterior devolvería "transacción abortada".
            if (esChoqueDeIdempotencia(error) && sync.clientOperationId) {
                const previa = await buscarOperacionPrevia(Sales, sync.clientOperationId);
                if (previa) {
                    const visita = previa.visit_id
                        ? await StoreVisits.findOne({ where: { id: previa.visit_id }, attributes: ['sale_amount'] })
                        : null;
                    // Mismo criterio que en la relectura de arriba: si quedó apartada, se dice.
                    const apartada = Boolean(previa.conflict_reason);
                    return res.status(200).json({
                        success: true, status: 200,
                        code: apartada ? CODIGOS.REGISTRADA_CON_CONFLICTO : CODIGOS.YA_REGISTRADO,
                        message: apartada ? previa.conflict_reason : 'Esta venta ya estaba registrada.',
                        data: {
                            id: previa.id,
                            total_amount: num(previa.total_amount),
                            item_count: await SaleItems.count({ where: { sale_id: previa.id } }),
                            location_id: previa.location_id,
                            visit_sale_amount: apartada ? null : (visita ? num(visita.sale_amount) : null),
                            ...(apartada ? { conflict_reason: previa.conflict_reason } : {}),
                        },
                    });
                }
            }

            // El trigger de stock lanza check_violation (23514) si una SALIDA dejaría el saldo negativo
            // (carrera concurrente que el pre-chequeo no alcanzó a ver). Se traduce a 409 amigable.
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, code: CODIGOS.STOCK_INSUFICIENTE, message: 'Stock insuficiente para completar la venta (el inventario cambió). Revisa las cantidades e intenta de nuevo.' });
            }
            console.error('Error al crear venta:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al registrar la venta.' });
        }
    },

    /**
     * 🧾 GET /api/sales/pos-catalog — Qué puede vender AHORA el usuario logueado.
     *
     * Única fuente del punto de venta. El SERVIDOR decide según el modo de la compañía y el
     * cliente solo pinta: así la regla de negocio no queda repartida en un componente de React,
     * y el POS no necesita permisos del módulo de inventario para cargar su lista (se gatea con
     * el mismo permiso que registrar la venta).
     *
     * Respuesta:
     *   - `mode`     → modo de la compañía (para textos/UI).
     *   - `location` → bodega de la que sale la mercancía, o null si la venta no toca inventario.
     *   - `items`    → productos vendibles (siempre el CATÁLOGO; ver `listarProductosVendibles`).
     *                  `disponible` es un número cuando hay control de stock —incluido **0** para
     *                  lo agotado, que se muestra en vez de ocultarse— y **null** cuando no lo hay.
     *   - `bloqueo`  → { code, message } si el usuario NO puede vender (sin bodega, bodega cerrada,
     *                  sin bodega principal). null si puede. El POS muestra el aviso y bloquea.
     */
    async getPosCatalog(req, res) {
        try {
            const company_id = req.user.companyId;
            const user_id = req.user.id;
            const mode = req.user.companySalesInventoryMode || 'sin_inventario';

            const formatLocation = (loc) => ({ id: loc.id, name: loc.name, type: loc.type });
            const responder = ({ location = null, items = [], bloqueo = null }) => res.status(200).json({
                success: true,
                status: 200,
                message: bloqueo ? bloqueo.message : 'Catálogo obtenido exitosamente',
                mode,
                location,
                items,
                bloqueo,
            });

            // 1) ¿De qué bodega sale la mercancía? (null = la venta no toca inventario)
            let location = null;

            if (mode === 'descuenta_bodegas') {
                location = await InventoryLocations.findOne({ where: { company_id, user_id } });
                if (!location) {
                    return responder({
                        bloqueo: {
                            code: 'sin_bodega',
                            message: 'No tienes una bodega asignada para vender. Comunícate con tu supervisor para que te asigne una.',
                        },
                    });
                }
                if (!bodegaOperativa(location)) {
                    return responder({
                        location: formatLocation(location),
                        bloqueo: {
                            code: 'bodega_no_operativa',
                            message: 'Tu bodega está inactiva o cerrada; no puedes vender desde ella.',
                        },
                    });
                }
            } else if (mode === 'descuenta_central') {
                // Todos venden de la MISMA bodega central; no hace falta ser responsable de ninguna.
                location = await InventoryLocations.findOne({ where: { company_id, is_default: true } });
                if (!location) {
                    return responder({
                        bloqueo: {
                            code: 'sin_central',
                            message: 'Tu compañía no tiene una bodega principal configurada; no se puede vender.',
                        },
                    });
                }
                if (!bodegaOperativa(location)) {
                    return responder({
                        location: formatLocation(location),
                        bloqueo: {
                            code: 'bodega_no_operativa',
                            message: 'La bodega principal está inactiva o cerrada; no se puede vender desde ella.',
                        },
                    });
                }
            }

            // 2) Qué se lista: en modo bodegas, SOLO lo que esa bodega ha recibido (con lo agotado
            //    en 0); en los demás, el catálogo. Ver `listarProductosVendibles`.
            //    ⏳ El modo central sigue mostrando el catálogo; queda por decidir con el usuario si
            //    debe comportarse como el modo bodegas (solo lo que ha entrado a la central).
            const items = await listarProductosVendibles(company_id, location ? location.id : null, {
                soloLoRecibido: mode === 'descuenta_bodegas',
            });

            return responder({ location: location ? formatLocation(location) : null, items });
        } catch (error) {
            console.error('❌ Error al obtener el catálogo del punto de venta:', error);
            return res.status(500).json({
                success: false, status: 500,
                message: 'Error al cargar los productos para vender',
                mode: null, location: null, items: [], bloqueo: null,
            });
        }
    },
};
