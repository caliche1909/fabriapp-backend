const crypto = require('crypto');
const {
    stock_transfers,
    stock_transfer_items,
    inventory_locations,
    products,
    product_categories,
    product_presentations,
    product_stock_balances,
    product_stock_movements,
    users,
    sequelize,
} = require('../models');
const { Op } = require('sequelize');

// 🔧 Helpers numéricos (mismos criterios que el resto del stock de productos).
const num = (v) => (v != null ? parseFloat(v) : 0);
// Margen (%) = round((venta - costo) / venta * 100). NULL si falta venta o costo.
const computeMargin = (salePrice, cost) => {
    if (!salePrice || !cost) return null;
    return Math.round(((salePrice - cost) / salePrice) * 100);
};

/**
 * 🔀 CONTROLADOR DE TRASPASOS (stock_transfers)
 *
 * Multi-tenant: todo se filtra SIEMPRE por la compañía de la sesión (req.user.companyId).
 * Paranoid: los traspasos eliminados quedan fuera automáticamente.
 *
 * Alcance de la lista (quién ve qué):
 *   - OWNER                           → TODOS los traspasos de su compañía.
 *   - Colaborador con `view_transfers` → TODOS los traspasos de su compañía.
 *   - Colaborador SIN ese permiso     → SOLO los traspasos en los que está involucrado:
 *       (a) los que EMITIÓ (stock_transfers.user_id = req.user.id), y
 *       (b) los que salen/entran a una BODEGA de la que es RESPONSABLE (from/to_location.user_id = él).
 *     El punto (b) es imprescindible para el flujo "por recibir": el responsable de una bodega
 *     destino tiene que ver el traspaso entrante para poder recibirlo.
 */

// 🔧 Da forma a un traspaso para la lista (solo metadatos; el detalle por ítem va aparte).
const formatTransfer = (tr, countsMap) => ({
    id: tr.id,
    transfer_number: tr.transfer_number,
    status: tr.status,
    from_location: tr.from_location
        ? { id: tr.from_location.id, name: tr.from_location.name }
        : { id: tr.from_location_id, name: '—' },
    to_location: tr.to_location
        ? { id: tr.to_location.id, name: tr.to_location.name }
        : { id: tr.to_location_id, name: '—' },
    items_count: countsMap[tr.id] || 0,
    has_discrepancy: tr.has_discrepancy,
    discrepancy_resolved: tr.discrepancy_resolved,
    notes: tr.notes,
    emitter: tr.user
        ? { id: tr.user.id, name: `${tr.user.first_name || ''} ${tr.user.last_name || ''}`.trim() }
        : null,
    created_at: tr.created_at,
    shipped_at: tr.shipped_at,
    received_at: tr.received_at,
});

// 🔧 Da forma a un ÍTEM del traspaso (para el detalle de recepción).
//    `quantity` = lo enviado por el emisor; `received_quantity` = lo recibido (NULL si aún no).
const formatTransferItem = (it) => ({
    id: it.id,
    product_id: it.product_id,
    quantity: num(it.quantity),
    received_quantity: it.received_quantity != null ? num(it.received_quantity) : null,
    unit_cost: it.unit_cost != null ? num(it.unit_cost) : null,
    sale_price_snapshot: it.sale_price_snapshot != null ? num(it.sale_price_snapshot) : null,
    margin_snapshot: it.margin_snapshot != null ? num(it.margin_snapshot) : null,
    product: it.product ? {
        id: it.product.id,
        name: it.product.name,
        sku: it.product.sku,
        category: it.product.category ? { id: it.product.category.id, name: it.product.category.name } : null,
        presentation: it.product.presentation ? { id: it.product.presentation.id, name: it.product.presentation.name } : null,
    } : null,
});

// 🔧 Detalle completo de un traspaso: metadatos de la lista + sus ítems + auditoría de recepción/resolución.
const formatTransferDetail = (tr) => ({
    ...formatTransfer(tr, { [tr.id]: Array.isArray(tr.items) ? tr.items.length : 0 }),
    reception_notes: tr.reception_notes,
    received_by: tr.received_by_user
        ? { id: tr.received_by_user.id, name: `${tr.received_by_user.first_name || ''} ${tr.received_by_user.last_name || ''}`.trim() }
        : null,
    discrepancy_resolved_by: tr.discrepancy_resolved_by_user
        ? { id: tr.discrepancy_resolved_by_user.id, name: `${tr.discrepancy_resolved_by_user.first_name || ''} ${tr.discrepancy_resolved_by_user.last_name || ''}`.trim() }
        : null,
    discrepancy_resolved_at: tr.discrepancy_resolved_at,
    discrepancy_resolution_notes: tr.discrepancy_resolution_notes,
    items: Array.isArray(tr.items) ? tr.items.map(formatTransferItem) : [],
});

module.exports = {
    /**
     * 📋 GET /api/stock_transfers/list — Traspasos de la compañía según el alcance del usuario.
     * Devuelve la LISTA COMPLETA de su alcance. El frontend NO la cachea como catálogo (dato
     * transaccional): refresca en cada montaje. Ordena por creación (más recientes primero).
     */
    async getTransfers(req, res) {
        try {
            const company_id = req.user.companyId;

            // ¿Puede ver todos los traspasos? Owner, o colaborador con un permiso que implique
            // actuar sobre CUALQUIER traspaso de la compañía: ver (view_transfers), recibir
            // (receive_transfer) o resolver novedades (resolve_transfer_discrepancy). Estos dos
            // últimos autorizan la ACCIÓN en cualquier bodega, así que también deben poder LEER
            // (si no, un "recepcionista" con receive_transfer recibía 403 al abrir el detalle y
            // no podía recibir pese a tener el permiso).
            const canViewAll = req.user.userType === 'owner'
                || (Array.isArray(req.user.permissions) && req.user.permissions.some((p) =>
                    ['view_transfers', 'receive_transfer', 'resolve_transfer_discrepancy'].includes(p)));

            const where = { company_id };
            if (!canViewAll) {
                // Bodegas de las que el usuario es responsable (para ver lo que entra/sale de ellas).
                const myLocs = await inventory_locations.findAll({
                    where: { company_id, user_id: req.user.id },
                    attributes: ['id'],
                });
                const myLocIds = myLocs.map((l) => l.id);

                where[Op.or] = [
                    { user_id: req.user.id }, // los que emitió
                    ...(myLocIds.length
                        ? [{ from_location_id: { [Op.in]: myLocIds } }, { to_location_id: { [Op.in]: myLocIds } }]
                        : []),
                ];
            }

            const rows = await stock_transfers.findAll({
                where,
                include: [
                    // paranoid:false → si la bodega se eliminó luego, igual mostramos su nombre histórico.
                    { model: inventory_locations, as: 'from_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: inventory_locations, as: 'to_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                ],
                order: [['created_at', 'DESC']],
            });

            // Conteo de ítems por traspaso (una consulta agregada; evita traer todos los ítems).
            const ids = rows.map((r) => r.id);
            const countsMap = {};
            if (ids.length) {
                const counts = await stock_transfer_items.findAll({
                    attributes: ['transfer_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
                    where: { transfer_id: { [Op.in]: ids } },
                    group: ['transfer_id'],
                    raw: true,
                });
                counts.forEach((c) => { countsMap[c.transfer_id] = Number(c.cnt); });
            }

            return res.status(200).json({
                success: true,
                status: 200,
                message: rows.length ? 'Traspasos obtenidos exitosamente' : 'No hay traspasos para mostrar',
                transfers: rows.map((r) => formatTransfer(r, countsMap)),
            });
        } catch (error) {
            console.error('❌ Error al obtener los traspasos:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al obtener los traspasos',
                transfers: [],
            });
        }
    },

    /**
     * 🔎 GET /api/stock_transfers/:id — DETALLE de un traspaso (cabecera + sus ítems).
     * Se usa al RECIBIR: puebla el panel con los productos enviados y su cantidad.
     *
     * Alcance (igual que la lista): owner o `view_transfers` ven cualquiera de su compañía; el resto
     * SOLO si están involucrados (lo emitieron o son responsables de la bodega origen/destino).
     * Tenant-scoped: siempre filtrado por la compañía de la sesión.
     */
    async getTransferById(req, res) {
        try {
            const company_id = req.user.companyId;
            const transferId = parseInt(req.params.id, 10);
            if (!Number.isInteger(transferId) || transferId <= 0) {
                return res.status(400).json({ success: false, status: 400, message: 'Traspaso no válido', transfer: null });
            }

            const tr = await stock_transfers.findOne({
                where: { id: transferId, company_id },
                include: [
                    { model: inventory_locations, as: 'from_location', attributes: ['id', 'name', 'user_id'], required: false, paranoid: false },
                    { model: inventory_locations, as: 'to_location', attributes: ['id', 'name', 'user_id'], required: false, paranoid: false },
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                    { model: users, as: 'received_by_user', attributes: ['id', 'first_name', 'last_name'], required: false },
                    { model: users, as: 'discrepancy_resolved_by_user', attributes: ['id', 'first_name', 'last_name'], required: false },
                    {
                        model: stock_transfer_items,
                        as: 'items',
                        required: false,
                        include: [{
                            model: products,
                            as: 'product',
                            attributes: ['id', 'name', 'sku'],
                            required: false,
                            paranoid: false,
                            include: [
                                { model: product_categories, as: 'category', attributes: ['id', 'name'], required: false },
                                { model: product_presentations, as: 'presentation', attributes: ['id', 'name'], required: false },
                            ],
                        }],
                    },
                ],
                order: [[{ model: stock_transfer_items, as: 'items' }, 'id', 'ASC']],
            });

            if (!tr) {
                return res.status(404).json({ success: false, status: 404, message: 'El traspaso no existe o no pertenece a tu compañía', transfer: null });
            }

            // Alcance: si no puede verlo todo, debe estar involucrado en ESTE traspaso.
            // (view_transfers/receive_transfer/resolve_transfer_discrepancy → ver cualquiera; ver getTransfers.)
            const canViewAll = req.user.userType === 'owner'
                || (Array.isArray(req.user.permissions) && req.user.permissions.some((p) =>
                    ['view_transfers', 'receive_transfer', 'resolve_transfer_discrepancy'].includes(p)));
            if (!canViewAll) {
                const isEmitter = tr.user_id === req.user.id;
                const isFromResponsible = tr.from_location && tr.from_location.user_id === req.user.id;
                const isToResponsible = tr.to_location && tr.to_location.user_id === req.user.id;
                if (!isEmitter && !isFromResponsible && !isToResponsible) {
                    return res.status(403).json({ success: false, status: 403, message: 'No tienes acceso a este traspaso', transfer: null });
                }
            }

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Traspaso obtenido exitosamente',
                transfer: formatTransferDetail(tr),
            });
        } catch (error) {
            console.error('❌ Error al obtener el detalle del traspaso:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener el detalle del traspaso', transfer: null });
        }
    },

    /**
     * ➕ POST /api/stock_transfers/create — EMITE un traspaso (modelo de 2 pasos).
     * Body: { from_location_id, to_location_id, notes?, items:[{ product_id, quantity>0 }] }.
     *
     * Todo ocurre en UNA transacción (atómica: si algo falla, se revierte TODO):
     *   1) Valida origen/destino (de la compañía, distintos, activos y abiertos).
     *   2) Valida ítems (productos de la compañía, cantidades > 0, sin repetidos).
     *   3) BLOQUEA (FOR UPDATE) y lee los saldos del ORIGEN; valida que haya stock suficiente por ítem.
     *   4) Asigna `transfer_number` secuencial por compañía y crea la CABECERA (status `en_transito`,
     *      user_id = emisor, shipped_at = ahora) + las filas de `stock_transfer_items` (con snapshots
     *      de costo/venta/margen tomados del producto en el servidor).
     *   5) Genera una pata `TRASPASO_SALIDA` por ítem que DESCUENTA el origen (el trigger de BD aplica
     *      el saldo y rechaza negativos como red de seguridad → 409). Las patas se enlazan por
     *      `transfer_group_id` y referencian la cabecera (`reference_type`/`reference_id`).
     * El stock del DESTINO NO se toca aquí: entra al RECIBIR (paso 2, futuro).
     *
     * Permiso: `create_transfer` (owner bypassa). El alcance de origen/destino es cualquier bodega de
     * la compañía (no se exige ser responsable).
     */
    async createTransfer(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const userId = req.user.id;
            const fromId = parseInt(req.body.from_location_id, 10);
            const toId = parseInt(req.body.to_location_id, 10);
            const { notes } = req.body;
            const rawItems = req.body.items;

            // 1) Bodegas: válidas y distintas.
            if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId <= 0 || toId <= 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Selecciona bodegas de origen y destino válidas' });
            }
            if (fromId === toId) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega de origen y la de destino deben ser distintas' });
            }

            // 2) Ítems: forma, cantidades y sin repetidos.
            if (!Array.isArray(rawItems) || rawItems.length === 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Agrega al menos un producto al traspaso' });
            }
            const items = [];
            const seen = new Set();
            for (const it of rawItems) {
                const product_id = parseInt(it && it.product_id, 10);
                const quantity = Number(it && it.quantity);
                if (!Number.isInteger(product_id) || product_id <= 0) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Uno de los productos no es válido' });
                }
                if (!Number.isFinite(quantity) || quantity <= 0) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Las cantidades deben ser mayores que cero' });
                }
                if (seen.has(product_id)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Hay un producto repetido en el traspaso' });
                }
                seen.add(product_id);
                items.push({ product_id, quantity });
            }

            // 1b) Cargar bodegas (tenant-scoped) y validar que estén operativas.
            const [from, to] = await Promise.all([
                inventory_locations.findOne({ where: { id: fromId, company_id }, transaction: t }),
                inventory_locations.findOne({ where: { id: toId, company_id }, transaction: t }),
            ]);
            if (!from) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega de origen no existe o no pertenece a tu compañía' });
            }
            if (!to) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega de destino no existe o no pertenece a tu compañía' });
            }
            for (const [loc, label] of [[from, 'origen'], [to, 'destino']]) {
                if (!loc.is_active || loc.status !== 'abierta') {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: `La bodega de ${label} no está operativa (debe estar activa y abierta)` });
                }
            }

            // 🔐 Autorización de emisión (3 niveles):
            //   - OWNER o con permiso `create_transfer` → puede emitir desde CUALQUIER bodega.
            //   - SIN ese permiso → SOLO si es el ENCARGADO (responsable) de la bodega de ORIGEN.
            const isOwner = req.user.userType === 'owner';
            const hasCreatePerm = isOwner
                || (Array.isArray(req.user.permissions) && req.user.permissions.includes('create_transfer'));
            if (!hasCreatePerm && from.user_id !== req.user.id) {
                await t.rollback();
                return res.status(403).json({
                    success: false, status: 403,
                    message: 'No tienes permiso para emitir traspasos desde esta bodega (solo su encargado puede)',
                });
            }

            // 2b) Productos de la compañía.
            const productIds = items.map((i) => i.product_id);
            const prods = await products.findAll({ where: { id: productIds, company_id }, transaction: t });
            if (prods.length !== productIds.length) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Uno o más productos no son válidos o no pertenecen a tu compañía' });
            }
            const prodMap = new Map(prods.map((p) => [p.id, p]));

            // 3) Bloquear (FOR UPDATE) y validar saldos del ORIGEN (serializa traspasos concurrentes).
            const balances = await product_stock_balances.findAll({
                where: { company_id, location_id: from.id, product_id: productIds },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            const balMap = new Map(balances.map((b) => [b.product_id, num(b.balance)]));
            for (const it of items) {
                const available = balMap.get(it.product_id) ?? 0;
                if (it.quantity > available) {
                    const p = prodMap.get(it.product_id);
                    await t.rollback();
                    return res.status(409).json({
                        success: false, status: 409,
                        message: `Stock insuficiente de "${p ? p.name : 'producto'}" en el origen. Disponible: ${available}, solicitado: ${it.quantity}`,
                    });
                }
            }

            // 4) Número secuencial por compañía (el índice único es la red anti-carrera).
            const numRows = await sequelize.query(
                'SELECT COALESCE(MAX(transfer_number), 0) + 1 AS next FROM public.stock_transfers WHERE company_id = :cid',
                { replacements: { cid: company_id }, transaction: t, type: sequelize.QueryTypes.SELECT }
            );
            const transferNumber = Number(numRows[0].next);
            const transferGroupId = crypto.randomUUID();
            const now = new Date();

            const header = await stock_transfers.create({
                company_id,
                from_location_id: from.id,
                to_location_id: to.id,
                status: 'en_transito',
                transfer_number: transferNumber,
                notes: (notes && String(notes).trim()) || null,
                user_id: userId,
                shipped_at: now,
            }, { transaction: t });

            // 4b + 5) Ítems (con snapshots) + patas TRASPASO_SALIDA (descuentan el origen vía trigger).
            for (const it of items) {
                const p = prodMap.get(it.product_id);
                const cost = num(p.production_cost);
                const sale = num(p.sale_price);
                const margin = computeMargin(sale, cost);

                await stock_transfer_items.create({
                    company_id,
                    transfer_id: header.id,
                    product_id: it.product_id,
                    quantity: it.quantity,
                    received_quantity: null,
                    unit_cost: cost,
                    sale_price_snapshot: sale,
                    margin_snapshot: margin,
                }, { transaction: t });

                await product_stock_movements.create({
                    company_id,
                    product_id: it.product_id,
                    location_id: from.id,
                    quantity_change: -it.quantity,
                    movement_type: 'TRASPASO_SALIDA',
                    transfer_group_id: transferGroupId,
                    unit_cost: cost,
                    sale_price_snapshot: sale,
                    margin_snapshot: margin,
                    reference_type: 'stock_transfer',
                    reference_id: header.id,
                    description: `Traspaso #${transferNumber} → ${to.name}`,
                    user_id: userId,
                }, { transaction: t });
            }

            await t.commit();

            // Releer para responder en formato de lista (con nombres de bodegas y emisor).
            const created = await stock_transfers.findOne({
                where: { id: header.id },
                include: [
                    { model: inventory_locations, as: 'from_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: inventory_locations, as: 'to_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                ],
            });

            return res.status(201).json({
                success: true,
                status: 201,
                message: `Traspaso #${transferNumber} emitido exitosamente`,
                transfer: formatTransfer(created, { [header.id]: items.length }),
            });
        } catch (error) {
            await t.rollback();
            // El trigger de saldo lanza check_violation (23514) si el origen quedaría negativo.
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, message: 'Stock insuficiente en el origen para emitir el traspaso' });
            }
            // Choque del número secuencial (dos traspasos a la vez): reintentable.
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Otro traspaso se creó al mismo tiempo. Vuelve a intentarlo.' });
            }
            console.error('❌ Error al crear el traspaso:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al crear el traspaso' });
        }
    },

    /**
     * 📥 POST /api/stock_transfers/:id/receive — RECIBE un traspaso (paso 2, cierra el ciclo).
     * Body: { items:[{ item_id, received_quantity>=0 }], reception_notes? }.
     *
     * Modelo PROFESIONAL a prueba de discrepancias (acordado con el usuario):
     *   - La recepción registra la VERDAD FÍSICA del destino: por cada ítem se genera una pata
     *     `TRASPASO_ENTRADA` en la bodega DESTINO con `quantity_change = +received_quantity`
     *     (siempre positiva → el trigger de saldo NUNCA la rechaza; crea la fila de balance si no existe).
     *   - El ORIGEN NO se vuelve a tocar (ya se descontó `quantity` al emitir). Así, un FALTANTE queda
     *     como merma en tránsito (neto −), y un SOBRANTE deja el origen sobrevaluado; ambos se cuadran
     *     después con un AJUSTE deliberado en la bodega correspondiente. La recepción no inventa stock.
     *   - Se guarda `received_quantity` por ítem (dato para la novedad). Si algún ítem difiere de lo
     *     enviado → `has_discrepancy = true` y `reception_notes` es OBLIGATORIO (justificar la novedad).
     *   - Todo en UNA transacción atómica: si algo falla, se revierte TODO.
     *   - Anti doble-recepción: se bloquea la cabecera (FOR UPDATE) y solo se recibe si está `en_transito`.
     *
     * Autorización (3 niveles, análoga a emitir pero sobre el DESTINO):
     *   - OWNER o con permiso `receive_transfer` → puede recibir en CUALQUIER bodega.
     *   - SIN ese permiso → SOLO si es el ENCARGADO (responsable) de la bodega DESTINO.
     */
    async receiveTransfer(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const userId = req.user.id;
            const transferId = parseInt(req.params.id, 10);
            if (!Number.isInteger(transferId) || transferId <= 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Traspaso no válido' });
            }

            // 1) Bloquear la cabecera (serializa recepciones concurrentes → evita doble entrada).
            //    Sin includes para que el FOR UPDATE aplique limpio sobre una sola tabla.
            const header = await stock_transfers.findOne({
                where: { id: transferId, company_id },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            if (!header) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'El traspaso no existe o no pertenece a tu compañía' });
            }
            if (header.status !== 'en_transito') {
                await t.rollback();
                return res.status(409).json({ success: false, status: 409, message: 'Este traspaso ya fue recibido o no está en tránsito' });
            }

            // 2) Bodegas (tenant-scoped). El destino debe seguir activo para poder recibir en él.
            const [from, to] = await Promise.all([
                inventory_locations.findOne({ where: { id: header.from_location_id, company_id }, transaction: t, paranoid: false }),
                inventory_locations.findOne({ where: { id: header.to_location_id, company_id }, transaction: t }),
            ]);
            if (!to) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega de destino no existe o no pertenece a tu compañía' });
            }
            if (!to.is_active) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega de destino está desactivada; no se puede recibir en ella' });
            }
            // Simetría con la emisión (que exige origen y destino activos Y abiertos): no se puede
            // recibir en una bodega cerrada. Debe reabrirse primero para cerrar el ciclo del traspaso.
            if (to.status !== 'abierta') {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega de destino está cerrada; ábrela para poder recibir en ella' });
            }

            // 🔐 Autorización de recepción (3 niveles) sobre el DESTINO.
            const isOwner = req.user.userType === 'owner';
            const hasReceivePerm = isOwner
                || (Array.isArray(req.user.permissions) && req.user.permissions.includes('receive_transfer'));
            if (!hasReceivePerm && to.user_id !== userId) {
                await t.rollback();
                return res.status(403).json({
                    success: false, status: 403,
                    message: 'No tienes permiso para recibir en esta bodega (solo su encargado puede)',
                });
            }

            // 3) Ítems reales del traspaso.
            const items = await stock_transfer_items.findAll({
                where: { transfer_id: header.id, company_id },
                transaction: t,
            });
            if (items.length === 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'El traspaso no tiene ítems para recibir' });
            }

            // 4) Cantidades recibidas del body, mapeadas por item_id. Se exige recibir TODOS los ítems
            //    en un solo acto (una cantidad por cada ítem del traspaso); sin cantidades negativas;
            //    SIN tope superior (se puede recibir MÁS de lo enviado → sobrante).
            const rawItems = req.body && req.body.items;
            if (!Array.isArray(rawItems) || rawItems.length === 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Debes indicar las cantidades recibidas' });
            }
            const recvMap = new Map();
            for (const it of rawItems) {
                const itemId = parseInt(it && it.item_id, 10);
                const qty = Number(it && it.received_quantity);
                if (!Number.isInteger(itemId) || itemId <= 0) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Uno de los ítems recibidos no es válido' });
                }
                if (!Number.isFinite(qty) || qty < 0) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Las cantidades recibidas no pueden ser negativas' });
                }
                if (recvMap.has(itemId)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Hay un ítem repetido en la recepción' });
                }
                recvMap.set(itemId, qty);
            }
            // Cada ítem del traspaso debe venir en el body, y no debe haber ítems ajenos.
            const validIds = new Set(items.map((i) => i.id));
            for (const it of items) {
                if (!recvMap.has(it.id)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Debes indicar la cantidad recibida de todos los ítems del traspaso' });
                }
            }
            for (const itemId of recvMap.keys()) {
                if (!validIds.has(itemId)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Un ítem recibido no pertenece a este traspaso' });
                }
            }

            // 5) ¿Hay discrepancia? (algún recibido ≠ enviado). Si la hay, la nota es obligatoria.
            let hasDiscrepancy = false;
            for (const it of items) {
                if (recvMap.get(it.id) !== num(it.quantity)) { hasDiscrepancy = true; break; }
            }
            const receptionNotes = (req.body && req.body.reception_notes && String(req.body.reception_notes).trim()) || null;
            if (hasDiscrepancy && !receptionNotes) {
                await t.rollback();
                return res.status(400).json({
                    success: false, status: 400,
                    message: 'Hay diferencias entre lo enviado y lo recibido: debes escribir una nota que explique la novedad',
                });
            }

            // 6) Reusar el transfer_group_id de la SALIDA para enlazar ambas patas del traspaso.
            const salida = await product_stock_movements.findOne({
                where: { company_id, reference_type: 'stock_transfer', reference_id: header.id, movement_type: 'TRASPASO_SALIDA' },
                transaction: t,
            });
            const transferGroupId = (salida && salida.transfer_group_id) || crypto.randomUUID();
            const now = new Date();

            // 7) Por cada ítem: guardar received_quantity + generar la ENTRADA en destino (si > 0).
            for (const it of items) {
                const received = recvMap.get(it.id);
                await it.update({ received_quantity: received }, { transaction: t });

                if (received > 0) {
                    await product_stock_movements.create({
                        company_id,
                        product_id: it.product_id,
                        location_id: to.id,
                        quantity_change: received, // positivo → entra al destino (el trigger crea/actualiza el saldo)
                        movement_type: 'TRASPASO_ENTRADA',
                        transfer_group_id: transferGroupId,
                        unit_cost: it.unit_cost,
                        sale_price_snapshot: it.sale_price_snapshot,
                        margin_snapshot: it.margin_snapshot,
                        reference_type: 'stock_transfer',
                        reference_id: header.id,
                        description: `Recepción traspaso #${header.transfer_number} desde ${from ? from.name : 'origen'}`,
                        user_id: userId,
                    }, { transaction: t });
                }
            }

            // 8) Cerrar la cabecera: completado + auditoría de recepción.
            await header.update({
                status: 'completado',
                received_by: userId,
                received_at: now,
                has_discrepancy: hasDiscrepancy,
                reception_notes: receptionNotes,
            }, { transaction: t });

            await t.commit();

            // Releer para responder en formato de lista (con nombres de bodegas y emisor).
            const updated = await stock_transfers.findOne({
                where: { id: header.id },
                include: [
                    { model: inventory_locations, as: 'from_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: inventory_locations, as: 'to_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                ],
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: hasDiscrepancy
                    ? `Traspaso #${header.transfer_number} recibido con novedad`
                    : `Traspaso #${header.transfer_number} recibido exitosamente`,
                transfer: formatTransfer(updated, { [header.id]: items.length }),
            });
        } catch (error) {
            await t.rollback();
            // Red de seguridad del trigger (no debería dispararse: la ENTRADA es positiva).
            if (error && error.original && error.original.code === '23514') {
                return res.status(409).json({ success: false, status: 409, message: 'No se pudo aplicar el saldo en la bodega de destino' });
            }
            console.error('❌ Error al recibir el traspaso:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al recibir el traspaso' });
        }
    },

    /**
     * ✅ PATCH /api/stock_transfers/:id/resolve — Marca la NOVEDAD de un traspaso como CUADRADA.
     * Body: { resolution_notes? }.
     *
     * Es un acuse de auditoría: NO mueve stock (el cuadre real se hace con un AJUSTE en la bodega).
     * Solo aplica a traspasos `completado` CON `has_discrepancy = true` y que aún no estén resueltos.
     *
     * Autorización (3 niveles): owner · o con permiso `resolve_transfer_discrepancy` · o si es el
     * responsable de la bodega ORIGEN o DESTINO del traspaso.
     */
    async resolveDiscrepancy(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const userId = req.user.id;
            const transferId = parseInt(req.params.id, 10);
            if (!Number.isInteger(transferId) || transferId <= 0) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Traspaso no válido' });
            }

            // Bloquear la cabecera (serializa marcados concurrentes).
            const header = await stock_transfers.findOne({
                where: { id: transferId, company_id },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            if (!header) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'El traspaso no existe o no pertenece a tu compañía' });
            }
            if (header.status !== 'completado' || !header.has_discrepancy) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Este traspaso no tiene una novedad por cuadrar' });
            }
            if (header.discrepancy_resolved) {
                await t.rollback();
                return res.status(409).json({ success: false, status: 409, message: 'Esta novedad ya fue resuelta' });
            }

            // 🔐 Autorización (3 niveles). Cargar responsables de origen/destino para el fallback.
            const isOwner = req.user.userType === 'owner';
            const hasPerm = isOwner
                || (Array.isArray(req.user.permissions) && req.user.permissions.includes('resolve_transfer_discrepancy'));
            if (!hasPerm) {
                const [from, to] = await Promise.all([
                    inventory_locations.findOne({ where: { id: header.from_location_id, company_id }, attributes: ['user_id'], transaction: t, paranoid: false }),
                    inventory_locations.findOne({ where: { id: header.to_location_id, company_id }, attributes: ['user_id'], transaction: t, paranoid: false }),
                ]);
                const isResponsible = (from && from.user_id === userId) || (to && to.user_id === userId);
                if (!isResponsible) {
                    await t.rollback();
                    return res.status(403).json({
                        success: false, status: 403,
                        message: 'No tienes permiso para cuadrar la novedad de este traspaso',
                    });
                }
            }

            // La nota es OBLIGATORIA: debe explicar cómo se cuadró (qué ajuste y en qué bodega).
            const resolutionNotes = (req.body && req.body.resolution_notes && String(req.body.resolution_notes).trim()) || null;
            if (!resolutionNotes) {
                await t.rollback();
                return res.status(400).json({
                    success: false, status: 400,
                    message: 'Debes escribir una nota que explique cómo se resolvió la novedad (qué ajuste y en qué bodega)',
                });
            }

            await header.update({
                discrepancy_resolved: true,
                discrepancy_resolved_by: userId,
                discrepancy_resolved_at: new Date(),
                discrepancy_resolution_notes: resolutionNotes,
            }, { transaction: t });

            const itemsCount = await stock_transfer_items.count({ where: { transfer_id: header.id }, transaction: t });

            await t.commit();

            const updated = await stock_transfers.findOne({
                where: { id: header.id },
                include: [
                    { model: inventory_locations, as: 'from_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: inventory_locations, as: 'to_location', attributes: ['id', 'name'], required: false, paranoid: false },
                    { model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false },
                ],
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: `Novedad del traspaso #${header.transfer_number} marcada como resuelta`,
                transfer: formatTransfer(updated, { [header.id]: itemsCount }),
            });
        } catch (error) {
            await t.rollback();
            console.error('❌ Error al cuadrar la novedad del traspaso:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al cuadrar la novedad del traspaso' });
        }
    },
};
