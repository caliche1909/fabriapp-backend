const {
    sequelize,
    product_stock_balances,
    product_stock_movements,
    products,
    product_categories,
    product_presentations,
    inventory_locations,
    users,
} = require('../models');
const { Op } = require('sequelize');

/**
 * 📦 CONTROLADOR DE STOCK DE PRODUCTOS (bodega central)
 *
 * Entradas / Salidas / Ajustes sobre la bodega central. Sigue el patrón de insumos pero
 * ENDURECIDO:
 *  - SIEMPRE en transacción.
 *  - El SIGNO del movimiento se deriva en el SERVIDOR desde el tipo (nunca se confía en el cliente).
 *  - `user_id` de la sesión (req.user.id), no del body.
 *  - Tenant-scoped: producto y bodega validados contra req.user.companyId (cierra IDOR).
 *  - La bodega CENTRAL se resuelve en el servidor (is_default); el cliente no la envía.
 *  - El trigger de BD ya rechaza saldo negativo (race-safe); se traduce a un 409 amigable.
 */

const DESTINATION_KINDS = ['BODEGA_MOVIL', 'PUNTO_VENTA', 'DISTRIBUIDOR', 'MERMA', 'OTRO'];

// 🔧 Resuelve la bodega central (is_default) de la compañía. Lanza si no existe.
async function getCentralLocation(company_id, transaction) {
    const central = await inventory_locations.findOne({
        where: { company_id, is_default: true },
        transaction,
    });
    return central; // puede ser null; el caller decide
}

// 🔧 Castea un número positivo. Devuelve { ok, value }.
function toPositiveNumber(raw) {
    if (raw === undefined || raw === null || raw === '') return { ok: false };
    const n = Number(raw);
    if (Number.isNaN(n) || n <= 0) return { ok: false };
    return { ok: true, value: n };
}

const num = (v) => (v != null ? parseFloat(v) : 0);

// 🔧 Margen (%) = round((venta - costo) / venta * 100). NULL si falta venta o costo (misma
//    regla que la tabla de productos, para que los números cuadren en toda la app).
const computeMargin = (salePrice, cost) => {
    if (!salePrice || !cost) return null;
    return Math.round(((salePrice - cost) / salePrice) * 100);
};

// 🔧 Formatea una fila de balance (con su producto) para el frontend.
//    `applyMinStock`: el mínimo del producto (`products.min_stock`) es un umbral de reorden que SOLO
//    aplica a la bodega CENTRAL (donde se produce/repone). En bodegas no-centrales NO hay concepto de
//    mínimo → `low_stock` siempre false (evita falsos "stock bajo" al mover producto a una bodega móvil).
const formatBalance = (b, applyMinStock = false) => ({
    id: b.id,
    product_id: b.product_id,
    location_id: b.location_id,
    balance: num(b.balance),
    last_updated: b.last_updated,
    product: b.product ? {
        id: b.product.id,
        name: b.product.name,
        sku: b.product.sku,
        min_stock: num(b.product.min_stock),
        production_cost: num(b.product.production_cost),
        sale_price: num(b.product.sale_price),
        is_active: b.product.is_active,
        category: b.product.category ? { id: b.product.category.id, name: b.product.category.name } : null,
        presentation: b.product.presentation ? { id: b.product.presentation.id, name: b.product.presentation.name } : null,
    } : null,
    low_stock: applyMinStock && b.product ? num(b.balance) <= num(b.product.min_stock) && num(b.product.min_stock) > 0 : false,
});

const formatMovement = (m) => ({
    id: m.id,
    product_id: m.product_id,
    location_id: m.location_id,
    quantity_change: num(m.quantity_change),
    movement_type: m.movement_type,
    destination_kind: m.destination_kind || null,
    unit_cost: m.unit_cost != null ? num(m.unit_cost) : null,
    sale_price_snapshot: m.sale_price_snapshot != null ? num(m.sale_price_snapshot) : null,
    margin_snapshot: m.margin_snapshot != null ? num(m.margin_snapshot) : null,
    description: m.description,
    created_at: m.created_at,
    // Bodega afectada por el movimiento. El histórico incluye movimientos de TODAS las bodegas
    // (central y ajustes/traspasos de bodegas no centrales), así que la UI debe poder distinguir
    // en cuál ocurrió cada uno para no leerlos todos como "central".
    location: m.location ? { id: m.location.id, name: m.location.name, is_default: m.location.is_default } : null,
    user: m.user ? { id: m.user.id, name: m.user.first_name, lastName: m.user.last_name } : null,
});

module.exports = {

    /**
     * 📋 GET /api/products_stock/balances — Saldos de la bodega central de la compañía.
     * Filtro opcional ?search= (nombre o sku del producto). Ordenado por nombre.
     */
    async getProductStockBalances(req, res) {
        try {
            const company_id = req.user.companyId;

            const central = await getCentralLocation(company_id);
            if (!central) {
                return res.status(200).json({
                    success: true, status: 200,
                    message: 'La compañía no tiene bodega central configurada',
                    balances: [], location: null,
                });
            }

            const productWhere = { company_id };
            const search = (req.query.search || '').trim();
            if (search) {
                productWhere[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { sku: { [Op.iLike]: `%${search}%` } },
                ];
            }

            const rows = await product_stock_balances.findAll({
                where: { company_id, location_id: central.id },
                include: [{
                    model: products,
                    as: 'product',
                    where: productWhere,
                    required: true,
                    include: [
                        { model: product_categories, as: 'category', attributes: ['id', 'name'] },
                        { model: product_presentations, as: 'presentation', attributes: ['id', 'name'] },
                    ],
                }],
                order: [[{ model: products, as: 'product' }, 'name', 'ASC']],
            });

            return res.status(200).json({
                success: true, status: 200,
                message: rows.length ? 'Saldos obtenidos exitosamente' : 'No hay productos en el inventario central',
                // Es la bodega central → el mínimo del producto SÍ aplica (umbral de reorden).
                balances: rows.map((b) => formatBalance(b, true)),
                location: { id: central.id, name: central.name, type: central.type },
            });
        } catch (error) {
            console.error('❌ Error al obtener saldos de stock:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener los saldos de stock', balances: [] });
        }
    },

    /**
     * 📍 GET /api/products_stock/balances/location/:locationId — Saldos de una bodega ESPECÍFICA.
     * Tenant-scoped: la bodega debe pertenecer a la compañía de la sesión (404 si no). Se usa, por
     * ejemplo, para poblar la lista de ítems del ORIGEN al emitir un traspaso, y para "ver stock por
     * bodega". Filtro opcional ?search= (nombre o sku). Ordenado por nombre de producto.
     */
    async getBalancesByLocation(req, res) {
        try {
            const company_id = req.user.companyId;
            const locationId = parseInt(req.params.locationId, 10);
            if (!Number.isInteger(locationId) || locationId <= 0) {
                return res.status(400).json({ success: false, status: 400, message: 'Bodega no válida', balances: [], location: null });
            }

            const location = await inventory_locations.findOne({ where: { id: locationId, company_id } });
            if (!location) {
                return res.status(404).json({ success: false, status: 404, message: 'La bodega no existe o no pertenece a tu compañía', balances: [], location: null });
            }

            const productWhere = { company_id };
            const search = (req.query.search || '').trim();
            if (search) {
                productWhere[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { sku: { [Op.iLike]: `%${search}%` } },
                ];
            }

            const rows = await product_stock_balances.findAll({
                where: { company_id, location_id: location.id },
                include: [{
                    model: products,
                    as: 'product',
                    where: productWhere,
                    required: true,
                    include: [
                        { model: product_categories, as: 'category', attributes: ['id', 'name'] },
                        { model: product_presentations, as: 'presentation', attributes: ['id', 'name'] },
                    ],
                }],
                order: [[{ model: products, as: 'product' }, 'name', 'ASC']],
            });

            return res.status(200).json({
                success: true, status: 200,
                message: rows.length ? 'Saldos obtenidos exitosamente' : 'Esta bodega no tiene productos en stock',
                // El mínimo del producto solo aplica si esta bodega ES la central; en las demás, sin "stock bajo".
                balances: rows.map((b) => formatBalance(b, location.is_default)),
                location: { id: location.id, name: location.name, type: location.type },
            });
        } catch (error) {
            console.error('❌ Error al obtener saldos de la bodega:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener los saldos de la bodega', balances: [], location: null });
        }
    },

    /**
     * ➕ POST /api/products_stock/movement — Registra ENTRADA / SALIDA / AJUSTE en la central.
     * Body: { product_id, movement_type, quantity (>0), direction? (ajuste),
     *         destination_kind? (salida), description? }.
     * El signo se deriva en el servidor; el costo/venta/margen se ESTAMPAN desde el producto
     * (snapshot, no se confía en el cliente); TODO en transacción; el trigger protege el saldo.
     */
    async registerMovement(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            // Nota: el costo/venta NO se toman del cliente; se estampan desde el producto (snapshot).
            const { product_id, movement_type, quantity, direction, destination_kind, description } = req.body;

            // 🔹 Tipo permitido (solo estos 3 por ahora; traspasos/producción son otro flujo).
            if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(movement_type)) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Tipo de movimiento no válido' });
            }

            // 🔹 Cantidad positiva.
            const qty = toPositiveNumber(quantity);
            if (!qty.ok) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La cantidad debe ser un número mayor que cero' });
            }

            // 🔹 Producto de la compañía (cierra IDOR).
            const product = await products.findOne({ where: { id: product_id, company_id }, transaction: t });
            if (!product) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'El producto no existe o no pertenece a tu compañía' });
            }

            // 🔹 Bodega central (resuelta en el servidor).
            const central = await getCentralLocation(company_id, t);
            if (!central) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La compañía no tiene bodega central configurada' });
            }

            // 🔹 Snapshot de precios: SIEMPRE desde el producto en este instante (nunca del cliente).
            //    El costo es el del producto; para cambiarlo se edita el producto, no el movimiento.
            const costSnapshot = num(product.production_cost);
            const salePriceSnapshot = num(product.sale_price);
            const marginSnapshot = computeMargin(salePriceSnapshot, costSnapshot);

            // 🔹 Derivar el SIGNO en el servidor + validaciones por tipo.
            let quantity_change;
            let dest = null;

            if (movement_type === 'ENTRADA') {
                quantity_change = qty.value;
            } else if (movement_type === 'SALIDA') {
                if (!DESTINATION_KINDS.includes(destination_kind)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Debes indicar un destino válido para la salida' });
                }
                quantity_change = -qty.value;
                dest = destination_kind;
            } else { // AJUSTE
                if (direction !== 'in' && direction !== 'out') {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'El ajuste debe indicar dirección (aumentar o disminuir)' });
                }
                quantity_change = direction === 'in' ? qty.value : -qty.value;
            }

            // 🔹 Pre-chequeo amigable de suficiencia (el trigger es el guardián real, race-safe).
            if (quantity_change < 0) {
                const bal = await product_stock_balances.findOne({
                    where: { product_id: product.id, location_id: central.id },
                    transaction: t,
                });
                const available = bal ? num(bal.balance) : 0;
                if (available + quantity_change < 0) {
                    await t.rollback();
                    return res.status(409).json({
                        success: false, status: 409,
                        message: `Stock insuficiente: disponible ${available}, intentas retirar ${qty.value}`,
                    });
                }
            }

            // 🔹 Insertar el movimiento (el trigger actualiza el balance y protege < 0).
            await product_stock_movements.create({
                company_id,
                product_id: product.id,
                location_id: central.id,
                quantity_change,
                movement_type,
                destination_kind: dest,
                unit_cost: costSnapshot,
                sale_price_snapshot: salePriceSnapshot,
                margin_snapshot: marginSnapshot,
                reference_type: 'manual',
                description: description ? String(description).trim() : null,
                user_id: req.user.id,
            }, { transaction: t });

            // 🔹 Releer el balance resultante.
            const updated = await product_stock_balances.findOne({
                where: { product_id: product.id, location_id: central.id },
                transaction: t,
            });

            await t.commit();

            return res.status(201).json({
                success: true, status: 201,
                message: 'Movimiento registrado exitosamente',
                product_id: product.id,
                balance: updated ? num(updated.balance) : 0,
            });
        } catch (error) {
            await t.rollback();
            // El trigger lanza check_violation (23514) si el saldo quedaría negativo.
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, message: 'Stock insuficiente para realizar el movimiento' });
            }
            console.error('❌ Error al registrar movimiento de stock:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo registrar el movimiento' });
        }
    },

    /**
     * 🔧 POST /api/products_stock/movement/location/:locationId — AJUSTE (+/−) en una bodega ESPECÍFICA.
     * Body: { product_id, quantity (>0), direction ('in'|'out'), description? }.
     *
     * Pensado para CUADRAR novedades de traspasos: se hace el ajuste en la bodega afectada (origen o
     * destino) y luego se marca la novedad como resuelta. Solo AJUSTE (ENTRADA/SALIDA siguen siendo de
     * la central, vía /movement). Mismo endurecimiento: transacción, signo derivado en el servidor,
     * snapshots desde el producto, y el trigger protege el saldo negativo.
     *
     * Autorización (3 niveles, en el controlador): owner · con `create_products_stock` · o si es el
     * RESPONSABLE de esa bodega (para que el encargado pueda cuadrar su propia bodega sin el permiso global).
     */
    async adjustLocationStock(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const userId = req.user.id;
            const locationId = parseInt(req.params.locationId, 10);
            const { product_id, quantity, direction, description } = req.body;

            if (!Number.isInteger(locationId) || locationId <= 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Bodega no válida' });
            }

            // Cantidad positiva y dirección válida.
            const qty = toPositiveNumber(quantity);
            if (!qty.ok) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La cantidad debe ser un número mayor que cero' });
            }
            if (direction !== 'in' && direction !== 'out') {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'El ajuste debe indicar dirección (aumentar o disminuir)' });
            }

            // Bodega de la compañía y operativa (activa + abierta).
            const location = await inventory_locations.findOne({ where: { id: locationId, company_id }, transaction: t });
            if (!location) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega no existe o no pertenece a tu compañía' });
            }
            if (!location.is_active || location.status !== 'abierta') {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega no está operativa (debe estar activa y abierta)' });
            }

            // 🔐 Autorización (3 niveles).
            const isOwner = req.user.userType === 'owner';
            const hasPerm = isOwner
                || (Array.isArray(req.user.permissions) && req.user.permissions.includes('create_products_stock'));
            if (!hasPerm && location.user_id !== userId) {
                await t.rollback();
                return res.status(403).json({ success: false, status: 403, message: 'No tienes permiso para ajustar el stock de esta bodega (solo su responsable puede)' });
            }

            // Producto de la compañía.
            const product = await products.findOne({ where: { id: product_id, company_id }, transaction: t });
            if (!product) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'El producto no existe o no pertenece a tu compañía' });
            }

            // Snapshot de precios (desde el producto; nunca del cliente) y signo derivado en el servidor.
            const costSnapshot = num(product.production_cost);
            const salePriceSnapshot = num(product.sale_price);
            const marginSnapshot = computeMargin(salePriceSnapshot, costSnapshot);
            const quantity_change = direction === 'in' ? qty.value : -qty.value;

            // Pre-chequeo amigable de suficiencia para disminuir (el trigger es el guardián real).
            if (quantity_change < 0) {
                const bal = await product_stock_balances.findOne({
                    where: { product_id: product.id, location_id: location.id },
                    transaction: t,
                });
                const available = bal ? num(bal.balance) : 0;
                if (available + quantity_change < 0) {
                    await t.rollback();
                    return res.status(409).json({ success: false, status: 409, message: `Stock insuficiente: disponible ${available}, intentas retirar ${qty.value}` });
                }
            }

            await product_stock_movements.create({
                company_id,
                product_id: product.id,
                location_id: location.id,
                quantity_change,
                movement_type: 'AJUSTE',
                unit_cost: costSnapshot,
                sale_price_snapshot: salePriceSnapshot,
                margin_snapshot: marginSnapshot,
                reference_type: 'manual',
                description: description ? String(description).trim() : null,
                user_id: userId,
            }, { transaction: t });

            const updated = await product_stock_balances.findOne({
                where: { product_id: product.id, location_id: location.id },
                transaction: t,
            });

            await t.commit();

            return res.status(201).json({
                success: true, status: 201,
                message: 'Ajuste registrado exitosamente',
                product_id: product.id,
                balance: updated ? num(updated.balance) : 0,
            });
        } catch (error) {
            await t.rollback();
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, message: 'Stock insuficiente para realizar el ajuste' });
            }
            console.error('❌ Error al ajustar el stock de la bodega:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo registrar el ajuste' });
        }
    },

    /**
     * 🕓 GET /api/products_stock/movements/:productId — Histórico de movimientos del producto (central).
     */
    async getProductMovements(req, res) {
        try {
            const company_id = req.user.companyId;
            const { productId } = req.params;

            // Validar pertenencia del producto a la compañía.
            const product = await products.findOne({ where: { id: productId, company_id } });
            if (!product) {
                return res.status(404).json({ success: false, status: 404, message: 'El producto no existe o no pertenece a tu compañía', movements: [] });
            }

            const rows = await product_stock_movements.findAll({
                where: { company_id, product_id: productId },
                include: [
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                    // paranoid:false → mostrar el nombre de la bodega aunque luego se haya eliminado.
                    { model: inventory_locations, as: 'location', attributes: ['id', 'name', 'is_default'], required: false, paranoid: false },
                ],
                order: [['created_at', 'DESC']],
                limit: 100,
            });

            return res.status(200).json({
                success: true, status: 200,
                message: 'Movimientos obtenidos exitosamente',
                movements: rows.map(formatMovement),
            });
        } catch (error) {
            console.error('❌ Error al obtener movimientos:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener los movimientos', movements: [] });
        }
    },
};
