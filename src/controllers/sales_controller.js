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
        const t = await Sales.sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const user_id = req.user.id;
            const { store_id, payment_method_id, route_id, visit_id, items } = req.body;

            // 1) Validaciones básicas.
            if (!store_id || !payment_method_id) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Faltan datos obligatorios (tienda y método de pago).' });
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
                    return res.status(400).json({ success: false, status: 400, message: 'No tienes una bodega asignada para vender. Comunícate con tu supervisor para que te asigne una.' });
                }
                if (!bodegaOperativa(location)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Tu bodega está inactiva o cerrada; no puedes vender desde ella.' });
                }
            } else if (mode === 'descuenta_central') {
                // La bodega CENTRAL de la compañía: todos venden de la misma y NO hace falta ser
                // responsable de ninguna bodega (ese es el sentido de este modo).
                location = await InventoryLocations.findOne({ where: { company_id, is_default: true }, transaction: t });
                if (!location) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Tu compañía no tiene una bodega principal configurada; no se puede registrar la venta.' });
                }
                if (!bodegaOperativa(location)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'La bodega principal está inactiva o cerrada; no se puede vender desde ella.' });
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
            if (visit_id) {
                const laVisita = await StoreVisits.findOne({ where: { id: visit_id }, transaction: t });
                if (!laVisita) {
                    await t.rollback();
                    return res.status(403).json({ success: false, status: 403, message: 'La visita indicada no existe.' });
                }
                if (laVisita.store_id !== parseInt(store_id, 10)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'La visita indicada no corresponde a esta tienda.' });
                }
                const permiso = await autorizarSobreLaVisita({ visita: laVisita, companyId: company_id, userId: user_id, transaction: t });
                if (!permiso.autorizado) {
                    await t.rollback();
                    return res.status(403).json({ success: false, status: 403, message: permiso.mensaje });
                }
                const existingNoSale = await store_no_sale_reports.findOne({ where: { visit_id }, transaction: t });
                if (existingNoSale) {
                    await t.rollback();
                    return res.status(409).json({ success: false, status: 409, message: 'Ya se envió un reporte de no-venta para esta visita; no se puede registrar una venta.' });
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
            if (!location) {
                const inactivo = prods.find((p) => !p.is_active);
                if (inactivo) {
                    await t.rollback();
                    return res.status(400).json({
                        success: false, status: 400,
                        message: `El producto "${inactivo.name}" ya no está disponible para la venta.`,
                    });
                }
            }

            // 7) Pre-chequeo de stock en la bodega (mensaje amigable). El trigger es el guardián real.
            //    Se salta cuando la venta no toca inventario (no hay saldo que consultar).
            if (location) {
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
                            success: false, status: 409,
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
                visit_id: visit_id || null,
                status: 'completed',
            }, { transaction: t });

            // 10) Ítems + movimientos SALIDA (el trigger descuenta el saldo y protege < 0).
            //     El ítem de venta se guarda SIEMPRE (es el detalle de la factura y la fuente del
            //     costo/margen en los reportes); el movimiento de stock solo si hay bodega.
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

                if (location) {
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
            let visitSaleAmount = null;
            if (visit_id) {
                await StoreVisits.increment({ sale_amount: total }, { where: { id: visit_id }, transaction: t });
                await StoreVisits.update({ status: 'completed' }, { where: { id: visit_id }, transaction: t });
                const v = await StoreVisits.findOne({ where: { id: visit_id }, attributes: ['sale_amount'], transaction: t });
                visitSaleAmount = v ? num(v.sale_amount) : null;
            }

            await t.commit();

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
            // El trigger de stock lanza check_violation (23514) si una SALIDA dejaría el saldo negativo
            // (carrera concurrente que el pre-chequeo no alcanzó a ver). Se traduce a 409 amigable.
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, message: 'Stock insuficiente para completar la venta (el inventario cambió). Revisa las cantidades e intenta de nuevo.' });
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
