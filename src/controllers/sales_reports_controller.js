const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

/**
 * 📊 CONTROLADOR DE REPORTES Y ANALÍTICA DE VENTAS
 *
 * Solo lectura. Todas las consultas se filtran por la compañía del usuario
 * autenticado (`req.user.companyId`) para respetar el aislamiento multi-tenant,
 * y excluyen ventas con soft-delete (`deleted_at IS NULL`).
 *
 * Se usa SQL crudo (agregaciones) por claridad y rendimiento sobre el ORM.
 * Todas las fechas se agrupan/filtran en la zona horaria local del negocio.
 */

// Zona horaria por defecto (fallback). La zona REAL se toma por compañía desde
// `req.user.companyTimezone` (Capa B) en cada handler; este valor solo aplica si
// esa compañía no tuviera zona configurada (no debería, la columna es NOT NULL).
const DEFAULT_TZ = 'America/Bogota';

// Formatos de agrupación temporal permitidos (whitelist anti-inyección).
const GRANULARITIES = {
    day: { trunc: 'day', format: 'YYYY-MM-DD' },
    month: { trunc: 'month', format: 'YYYY-MM' },
    year: { trunc: 'year', format: 'YYYY' },
};

/**
 * Resuelve el rango de fechas [from, to] (YYYY-MM-DD). Si no se envían, usa el
 * rango completo de ventas de la compañía para que siempre se muestren datos.
 */
async function resolveRange(companyId, tz, from, to) {
    const isValid = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (isValid(from) && isValid(to)) {
        return { from, to };
    }
    const [row] = await sequelize.query(
        `SELECT MIN(sale_date AT TIME ZONE :tz)::date AS min, MAX(sale_date AT TIME ZONE :tz)::date AS max
         FROM sales WHERE company_id = :cid AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT, replacements: { cid: companyId, tz } }
    );
    const today = new Date().toISOString().slice(0, 10);
    return {
        from: isValid(from) ? from : (row && row.min ? String(row.min).slice(0, 10) : today),
        to: isValid(to) ? to : (row && row.max ? String(row.max).slice(0, 10) : today),
    };
}

// Filtro SQL común de ventas por compañía, rango y no eliminadas.
const SALES_WHERE = `sa.company_id = :cid AND sa.deleted_at IS NULL
    AND (sa.sale_date AT TIME ZONE :tz)::date BETWEEN :from AND :to`;

/**
 * La definición de "cuánto suele comprar una tienda" se movió a `utils/referenciaCompra.js`
 * el 2026-09-12, cuando la lista de tiendas de una ruta pasó a enseñarla en cada tarjeta.
 *
 * 🔴 NO LA COPIES DE VUELTA AQUÍ. Con dos copias, el día que se ajuste la ventana de 90 días
 * el informe y la tarjeta dirían números distintos con el mismo nombre.
 */
const { CTE_REFERENCIA_TIENDA } = require('../utils/referenciaCompra');

module.exports = {
    /**
     * 📌 GET /api/sales/reports/summary?from&to
     * KPIs generales + top vendedores y tiendas para el Dashboard.
     */
    async getSummary(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;
            const { from, to } = await resolveRange(cid, tz, req.query.from, req.query.to);
            const repl = { cid, tz, from, to };

            const [kpis] = await sequelize.query(
                `SELECT
                    COALESCE(ROUND(SUM(sa.total_amount)), 0)::float8 AS total_vendido,
                    COUNT(*)::int AS num_ventas,
                    COALESCE(ROUND(AVG(sa.total_amount)), 0)::float8 AS ticket_promedio,
                    COUNT(DISTINCT sa.store_id)::int AS tiendas_atendidas,
                    COUNT(DISTINCT sa.user_id)::int AS vendedores
                 FROM sales sa WHERE ${SALES_WHERE}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // "visitas" = visitas REALES (status 'visited'/'completed'); las paradas
            // 'pending' (planificadas al iniciar ruta, aún sin visitar) no cuentan.
            const [visitas] = await sequelize.query(
                `SELECT
                    COUNT(*)::int AS visitas_total,
                    COALESCE(SUM((sv.sale_amount > 0)::int), 0)::int AS visitas_con_venta,
                    COALESCE(ROUND(100.0 * SUM((sv.sale_amount > 0)::int) / NULLIF(COUNT(*), 0), 1), 0)::float8 AS efectividad_pct
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 WHERE st.company_id = :cid
                   AND sv.status IN ('visited', 'completed')
                   AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const topVendedores = await sequelize.query(
                `SELECT sa.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa JOIN users u ON u.id = sa.user_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.user_id, nombre ORDER BY total DESC LIMIT 5`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const topTiendas = await sequelize.query(
                `SELECT sa.store_id, st.name AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa JOIN stores st ON st.id = sa.store_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.store_id, st.name ORDER BY total DESC LIMIT 5`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    kpis: { ...kpis, ...visitas },
                    top_vendedores: topVendedores,
                    top_tiendas: topTiendas,
                },
            });
        } catch (error) {
            console.error('Error en getSummary (reportes de ventas):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener el resumen de ventas' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/analytics?from&to&granularity=day|month|year
     * Serie temporal + desglose por vendedor, tienda (top/bottom) y método de pago.
     */
    async getAnalytics(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;
            const { from, to } = await resolveRange(cid, tz, req.query.from, req.query.to);
            const g = GRANULARITIES[req.query.granularity] || GRANULARITIES.month;
            const repl = { cid, tz, from, to };

            const serie = await sequelize.query(
                `SELECT to_char(date_trunc('${g.trunc}', sa.sale_date AT TIME ZONE :tz), '${g.format}') AS periodo,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa WHERE ${SALES_WHERE}
                 GROUP BY 1 ORDER BY 1`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const porVendedor = await sequelize.query(
                `SELECT sa.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas,
                        ROUND(AVG(sa.total_amount))::float8 AS ticket_promedio
                 FROM sales sa JOIN users u ON u.id = sa.user_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.user_id, nombre ORDER BY total DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const tiendasTop = await sequelize.query(
                `SELECT sa.store_id, st.name AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa JOIN stores st ON st.id = sa.store_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.store_id, st.name ORDER BY total DESC LIMIT 10`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const tiendasBottom = await sequelize.query(
                `SELECT sa.store_id, st.name AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa JOIN stores st ON st.id = sa.store_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.store_id, st.name ORDER BY total ASC LIMIT 10`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const porMetodoPago = await sequelize.query(
                `SELECT sa.payment_method_id, pm.name AS nombre,
                        ROUND(SUM(sa.total_amount))::float8 AS total,
                        COUNT(*)::int AS num_ventas
                 FROM sales sa JOIN payment_methods pm ON pm.id = sa.payment_method_id
                 WHERE ${SALES_WHERE}
                 GROUP BY sa.payment_method_id, pm.name ORDER BY total DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    granularity: GRANULARITIES[req.query.granularity] ? req.query.granularity : 'month',
                    serie,
                    por_vendedor: porVendedor,
                    tiendas_top: tiendasTop,
                    tiendas_bottom: tiendasBottom,
                    por_metodo_pago: porMetodoPago,
                },
            });
        } catch (error) {
            console.error('Error en getAnalytics (reportes de ventas):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener la analítica de ventas' });
        }
    },

    /**
     * 📌 GET /api/sales/list?from&to&store_id&user_id&payment_method_id&page&limit
     * Historial de ventas paginado con nombres de tienda, vendedor y método de pago.
     */
    /**
     * 🧾 GET /api/sales/reports/conflicts — VENTAS CON CONFLICTO.
     *
     * Ventas que llegaron al servidor cuando ya no cabían (la parada se había cerrado con un
     * reporte de no compra, reasignaron la ruta...). Se guardan igual —el vendedor ya había
     * cobrado— pero **apartadas**: nacen con `deleted_at`, así que todas las demás consultas las
     * excluyen. Ver `OFFLINE-CAMPO.md` §11.
     *
     * 🔴 SIN FILTRO DE FECHA, Y NO ES UN OLVIDO. Esto **no es un informe, es una lista de tareas**.
     * Si se filtrara por el rango del historial, la venta de hace tres semanas que nadie ha
     * resuelto desaparecería justo cuando el supervisor mira "esta semana" — y es precisamente la
     * más urgente. Por eso también van **las más viejas primero**.
     *
     * 🔴 SE FILTRA POR `conflict_reason IS NOT NULL`, no por `deleted_by IS NULL`. Las dos cosas
     * son ciertas hoy (el gancho `beforeDestroy` del modelo exige un `userId`, así que un borrado
     * humano siempre deja `deleted_by`), pero una afirmación positiva es más difícil de romper que
     * una ausencia: `conflict_reason` solo puede estar puesto porque lo pusimos nosotros.
     */
    async getConflictSales(req, res) {
        try {
            const cid = req.user.companyId;
            const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));

            const [count] = await sequelize.query(
                `SELECT COUNT(*)::int AS total
                   FROM sales sa
                  WHERE sa.company_id = :cid AND sa.conflict_reason IS NOT NULL`,
                { type: QueryTypes.SELECT, replacements: { cid } }
            );

            const rows = await sequelize.query(
                `SELECT sa.id, sa.sale_date, sa.total_amount::float8, sa.conflict_reason,
                        sa.synced_at, sa.created_at,
                        st.name AS store_name,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS user_name,
                        pm.name AS payment_method_name,
                        (SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = sa.id) AS item_count
                   FROM sales sa
                   JOIN stores st ON st.id = sa.store_id
                   JOIN users u ON u.id = sa.user_id
                   JOIN payment_methods pm ON pm.id = sa.payment_method_id
                  WHERE sa.company_id = :cid AND sa.conflict_reason IS NOT NULL
                  ORDER BY sa.sale_date ASC
                  LIMIT :limit`,
                { type: QueryTypes.SELECT, replacements: { cid, limit } }
            );

            return res.status(200).json({
                success: true,
                data: rows,
                // `total` puede ser mayor que `data.length` si se llegó al tope. La interfaz lo
                // dice en vez de fingir que están todas.
                total: count ? count.total : 0,
                limit,
            });
        } catch (error) {
            console.error('Error en getConflictSales (ventas con conflicto):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener las ventas con conflicto' });
        }
    },

    async getSalesList(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;
            const { from, to } = await resolveRange(cid, tz, req.query.from, req.query.to);
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
            const offset = (page - 1) * limit;

            // Filtros opcionales adicionales.
            const filters = [];
            const repl = { cid, tz, from, to, limit, offset };
            if (req.query.store_id) { filters.push('AND sa.store_id = :store_id'); repl.store_id = parseInt(req.query.store_id, 10); }
            if (req.query.user_id) { filters.push('AND sa.user_id = :user_id'); repl.user_id = req.query.user_id; }
            if (req.query.payment_method_id) { filters.push('AND sa.payment_method_id = :payment_method_id'); repl.payment_method_id = parseInt(req.query.payment_method_id, 10); }
            const extra = filters.join(' ');

            const [count] = await sequelize.query(
                `SELECT COUNT(*)::int AS total FROM sales sa WHERE ${SALES_WHERE} ${extra}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const rows = await sequelize.query(
                `SELECT sa.id, sa.sale_date, sa.subtotal::float8, sa.discount_amount::float8,
                        sa.tax_amount::float8, sa.total_amount::float8, sa.status,
                        st.name AS store_name,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS user_name,
                        pm.name AS payment_method_name
                 FROM sales sa
                 JOIN stores st ON st.id = sa.store_id
                 JOIN users u ON u.id = sa.user_id
                 JOIN payment_methods pm ON pm.id = sa.payment_method_id
                 WHERE ${SALES_WHERE} ${extra}
                 ORDER BY sa.sale_date DESC
                 LIMIT :limit OFFSET :offset`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const total = count ? count.total : 0;
            return res.status(200).json({
                success: true,
                data: rows,
                pagination: {
                    current_page: page,
                    records_per_page: limit,
                    total_records: total,
                    total_pages: Math.ceil(total / limit) || 1,
                },
                range: { from, to },
            });
        } catch (error) {
            console.error('Error en getSalesList (historial de ventas):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener el historial de ventas' });
        }
    },

    /**
     * 📌 GET /api/sales/detail/:sale_id
     * Una venta con el detalle de sus líneas. Alimenta el cajón de detalle del Cuadre y del
     * Historial, y más adelante la reimpresión del ticket (`IMPRESION-BLUETOOTH.md` §13, punto 6).
     *
     * 🔴 ES EL PRIMER LECTOR DE `sale_items`. Hasta hoy esa tabla solo se escribía: lo único que
     * alguien consultaba era un `COUNT(*)` en el cuadre de conflictos.
     *
     * ⚠️ QUE `items` VENGA VACÍO NO ES UN ERROR, Y HAY QUE CONTARLO EN PANTALLA. `sale_items`
     * empezó a escribirse a mediados de agosto de 2026. Medido sobre producción el 2026-09-15:
     * de 12.156 ventas solo 1.117 (9,2 %) tienen líneas — septiembre 677/677, agosto 440/1.291,
     * julio y antes CERO. Una venta anterior a ese corte devuelve `items: []` porque su detalle
     * **nunca existió**, no porque falle nada. Como toda venta exige al menos un producto para
     * poder registrarse, `items: []` significa exactamente eso y no hace falta ninguna bandera.
     *
     * 🔴 NO DEVUELVE `unit_cost`, y es deliberado. Es el costo de fabricación: el margen del
     * negocio. Este detalle lo abre un vendedor desde el Cuadre, y el ticket impreso saldrá de
     * aquí. No hay ningún motivo para que ese dato viaje al teléfono de nadie.
     *
     * 🔴 SÍ DEVUELVE LAS APARTADAS, y también es deliberado. Una venta apartada por conflicto
     * nace con `deleted_at` puesto, así que el filtro habitual la escondería — pero **el vendedor
     * ya cobró ese dinero** y quien tenga que cuadrarla necesita ver qué llevaba. Se admite
     * exactamente el mismo criterio que usa `getConflictSales`: `conflict_reason IS NOT NULL`, que
     * solo puede estar puesto porque lo pusimos nosotros. Una venta borrada por una persona (el
     * día que exista anular) seguirá oculta, porque esa no tendría `conflict_reason`.
     *
     * ⚠️ No se filtra `st.deleted_at` ni el estado del vendedor: una venta del pasado tiene que
     * poder consultarse aunque después se borrara la tienda o el vendedor dejara la empresa. El
     * aislamiento multi-tenant lo da `sa.company_id`, que sale de la SESIÓN y nunca del cliente.
     */
    async getSaleDetail(req, res) {
        try {
            const cid = req.user.companyId;
            const crudo = req.params.sale_id;

            // ⚠️ Se valida el TEXTO antes de convertirlo, no el resultado: `parseInt('1.5')` da 1,
            // así que pedir `/detail/1.5` devolvía tan campante la venta 1. Un identificador que
            // no es un identificador no puede resolverse a OTRA venta.
            const saleId = /^\d+$/.test(crudo) ? Number.parseInt(crudo, 10) : NaN;

            if (!Number.isInteger(saleId) || saleId <= 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Identificador de venta inválido.',
                });
            }

            // La cabecera se pide primero: además de traer los datos, ES la comprobación de
            // acceso. Si no aparece, no se consultan las líneas.
            const [venta] = await sequelize.query(
                `SELECT sa.id, sa.sale_date, sa.status,
                        sa.subtotal::float8        AS subtotal,
                        sa.discount_amount::float8 AS discount_amount,
                        sa.tax_amount::float8      AS tax_amount,
                        sa.total_amount::float8    AS total_amount,
                        sa.visit_id, sa.route_id,
                        sa.conflict_reason,
                        (sa.conflict_reason IS NOT NULL) AS apartada,
                        st.id AS store_id, st.name AS store_name,
                        st.address AS store_address, st.phone AS store_phone,
                        u.id AS user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS vendedor,
                        pm.id AS payment_method_id, pm.name AS payment_method
                   FROM sales sa
                   JOIN stores st ON st.id = sa.store_id
                   JOIN users u ON u.id = sa.user_id
                   JOIN payment_methods pm ON pm.id = sa.payment_method_id
                  WHERE sa.id = :sale_id
                    AND sa.company_id = :cid
                    AND (sa.deleted_at IS NULL OR sa.conflict_reason IS NOT NULL)`,
                { type: QueryTypes.SELECT, replacements: { sale_id: saleId, cid } }
            );

            if (!venta) {
                // Mismo 404 exista o no la venta en OTRA compañía: que no se pueda averiguar qué
                // identificadores existen probando números.
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La venta no existe o no pertenece a tu compañía.',
                });
            }

            // `quantity` es DECIMAL(14,3) y los precios DECIMAL(14,2): sin el cast, Sequelize los
            // entrega como TEXTO y el cliente acabaría concatenando en vez de sumando.
            const items = await sequelize.query(
                `SELECT si.product_id, si.product_name,
                        si.quantity::float8    AS quantity,
                        si.unit_price::float8  AS unit_price,
                        si.total_price::float8 AS total_price
                   FROM sale_items si
                  WHERE si.sale_id = :sale_id
                  ORDER BY si.id`,
                { type: QueryTypes.SELECT, replacements: { sale_id: saleId } }
            );

            return res.status(200).json({
                success: true,
                status: 200,
                data: { venta, items },
            });
        } catch (error) {
            console.error('Error en getSaleDetail (detalle de venta):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener el detalle de la venta' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/no-sale?from&to
     * Reportes de no-venta agregados por categoría y por razón.
     */
    async getNoSaleReport(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;
            const { from, to } = await resolveRange(cid, tz, req.query.from, req.query.to);
            const repl = { cid, tz, from, to };
            // 🚫 `annulled_at IS NULL`: un reporte anulado —el tendero acabó comprando— no es una
            // no-venta y no puede seguir contando en el total ni en el desglose. Las tres
            // consultas de abajo comparten esta constante, así que no pueden separarse.
            // Ver OFFLINE-CAMPO.md §14.7.
            const WHERE = `r.company_id = :cid AND r.annulled_at IS NULL AND (r.created_at AT TIME ZONE :tz)::date BETWEEN :from AND :to`;

            const [tot] = await sequelize.query(
                `SELECT COUNT(*)::int AS total FROM store_no_sale_reports r WHERE ${WHERE}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const porCategoria = await sequelize.query(
                `SELECT c.id AS category_id, c.name AS nombre, COUNT(*)::int AS total
                 FROM store_no_sale_reports r JOIN no_sale_categories c ON c.id = r.category_id
                 WHERE ${WHERE} GROUP BY c.id, c.name ORDER BY total DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const porRazon = await sequelize.query(
                `SELECT rs.id AS reason_id, rs.name AS nombre, c.name AS categoria, COUNT(*)::int AS total
                 FROM store_no_sale_reports r
                 JOIN no_sale_reasons rs ON rs.id = r.reason_id
                 JOIN no_sale_categories c ON c.id = r.category_id
                 WHERE ${WHERE} GROUP BY rs.id, rs.name, c.name ORDER BY total DESC LIMIT 15`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    total_reportes: tot ? tot.total : 0,
                    por_categoria: porCategoria,
                    por_razon: porRazon,
                },
            });
        } catch (error) {
            console.error('Error en getNoSaleReport (reportes de no-venta):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener los reportes de no-venta' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/no-sale/detail?from&to&page&limit&categoryId&reasonId&sellerId&storeId
     * Lista PAGINADA de reportes de no-venta INDIVIDUALES (detalle) de la compañía, con
     * tienda, vendedor, cliente, categoría/razón, comentario y fecha. Solo lectura, scopeado
     * por `req.user.companyId`. Complementa el agregado getNoSaleReport (drill-down).
     */
    async getNoSaleReportDetail(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;
            const { from, to } = await resolveRange(cid, tz, req.query.from, req.query.to);

            // Paginación con topes defensivos.
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
            const offset = (page - 1) * limit;

            // Filtros opcionales (todos parametrizados para evitar inyección).
            const { categoryId, reasonId, sellerId, storeId } = req.query;
            const repl = { cid, tz, from, to, limit, offset };
            // 🚫 `annulled_at IS NULL`, igual que en el resumen: el detalle tiene que cuadrar con
            // los totales que lo abren. Ver OFFLINE-CAMPO.md §14.7.
            let WHERE = `r.company_id = :cid AND r.annulled_at IS NULL AND (r.created_at AT TIME ZONE :tz)::date BETWEEN :from AND :to`;
            if (categoryId) { WHERE += ' AND r.category_id = :categoryId'; repl.categoryId = categoryId; }
            if (reasonId) { WHERE += ' AND r.reason_id = :reasonId'; repl.reasonId = reasonId; }
            if (sellerId) { WHERE += ' AND r.user_id = :sellerId'; repl.sellerId = sellerId; }
            if (storeId) { WHERE += ' AND r.store_id = :storeId'; repl.storeId = storeId; }

            const [tot] = await sequelize.query(
                `SELECT COUNT(*)::int AS total FROM store_no_sale_reports r WHERE ${WHERE}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const reportes = await sequelize.query(
                `SELECT r.id,
                        r.created_at AS fecha,
                        st.name AS tienda,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS vendedor,
                        c.name AS categoria,
                        rs.name AS razon,
                        r.comments AS comentario,
                        r.client_name AS cliente,
                        r.client_phone AS telefono
                 FROM store_no_sale_reports r
                 JOIN stores st ON st.id = r.store_id
                 LEFT JOIN users u ON u.id = r.user_id
                 JOIN no_sale_categories c ON c.id = r.category_id
                 JOIN no_sale_reasons rs ON rs.id = r.reason_id
                 WHERE ${WHERE}
                 ORDER BY r.created_at DESC
                 LIMIT :limit OFFSET :offset`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const total = tot ? tot.total : 0;
            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    reportes,
                    pagination: {
                        currentPage: page,
                        totalPages: Math.ceil(total / limit) || 1,
                        totalReports: total,
                        limit,
                    },
                },
            });
        } catch (error) {
            console.error('Error en getNoSaleReportDetail (detalle de no-venta):', error);
            return res.status(500).json({ success: false, message: 'Error al obtener el detalle de no-venta' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/sellers
     * Vendedores para el selector del Cuadre: **quien tiene historia en la compañía**, no
     * quien trabaja aquí hoy.
     *
     * 🔑 El Cuadre es un reporte HISTÓRICO y su tabla por vendedor sale de `store_visits`
     * unido a `users`, así que lista a cualquiera que tuviera paradas en el período —incluida
     * gente que ya salió de la empresa—. Este selector preguntaba `uc.status = 'active'`, o sea
     * una pregunta del PRESENTE, y por eso mostraba un nombre en la tabla que no se podía elegir
     * en el filtro. Medido en SILOÉ: en febrero de 2026 la tabla traía 3 vendedores y el selector
     * ofrecía 2; los $20.450.251 del tercero (el 55 % del mes) no tenían dueño seleccionable.
     * En todo el histórico eran 2.455 ventas / $83.338.774 imposibles de desglosar.
     *
     * Se listan, entonces:
     *   - los miembros ACTIVOS, aunque no hayan vendido nunca (hay que poder confirmar que
     *     alguien no hizo nada en el período: sin él en la lista, no se puede ni preguntar);
     *   - más cualquiera con visitas o ventas en esta compañía, siga o no siendo miembro.
     * Los inactivos SIN historia quedan fuera: filtrar por ellos solo devolvería ceros.
     *
     * El `LEFT JOIN` a `user_companies` es deliberado: cubre a quien perdió la membresía por
     * completo (fila borrada, no solo `status <> 'active'`) pero dejó ventas en el histórico.
     * `activo` viaja para que el selector marque a los que ya no están.
     */
    async getSellers(req, res) {
        try {
            const cid = req.user.companyId;
            const sellers = await sequelize.query(
                `SELECT u.id AS user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        COALESCE(uc.status = 'active', false) AS activo
                 FROM users u
                 LEFT JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = :cid
                 WHERE uc.status = 'active'
                    OR EXISTS (SELECT 1 FROM store_visits sv
                                 JOIN stores st ON st.id = sv.store_id
                                WHERE sv.user_id = u.id AND st.company_id = :cid)
                    OR EXISTS (SELECT 1 FROM sales sa
                                WHERE sa.user_id = u.id AND sa.company_id = :cid)
                 ORDER BY activo DESC, nombre`,
                { type: QueryTypes.SELECT, replacements: { cid } }
            );
            return res.status(200).json({ success: true, data: sellers });
        } catch (error) {
            console.error('Error en getSellers:', error);
            return res.status(500).json({ success: false, message: 'Error al obtener la lista de vendedores' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/cuadre?from&to&user_id
     * Cuadre de ventas: todas las visitas del período (con o sin venta), resumen
     * por vendedor y cuánto se debe cobrar en cada método de pago. Por defecto HOY.
     */
    async getCuadre(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;

            // Rango por defecto: HOY (fecha local del negocio).
            const isValid = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
            let { from, to } = req.query;
            if (!isValid(from) || !isValid(to)) {
                const [t] = await sequelize.query(
                    `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
                    { type: QueryTypes.SELECT, replacements: { tz } }
                );
                const hoy = String(t.hoy).slice(0, 10);
                if (!isValid(from)) from = hoy;
                if (!isValid(to)) to = hoy;
            }

            const userId = req.query.user_id || null;
            const repl = { cid, tz, from, to, user_id: userId };

            // Filtros por vendedor (opcionales). El de visitas apunta a `store_visits.user_id`,
            // que es quien REALMENTE tuvo esa parada ese día (tras un relevo, el que la resolvió).
            const visitUserFilter = userId ? 'AND sv.user_id = :user_id' : '';
            const saleUserFilter = userId ? 'AND sa.user_id = :user_id' : '';

            // Todas las filas de visita del período, sin filtrar por estado ni por ruta. Las
            // agregaciones de abajo separan con FILTER lo que corresponde a cada cifra, para que
            // TODA la pantalla se lea de una sola fuente y las tarjetas nunca se contradigan.
            //
            // Se filtra por `sv.date` (no por `visit_day`) igual que el resto del módulo; hoy
            // ambas columnas coinciden en el 100% de las filas.
            //
            // Las tiendas con soft-delete NO se excluyen a propósito: lo que pasó, pasó, y un
            // reporte histórico no puede cambiar porque alguien borre la tienda después.
            const PERIODO_WHERE = `st.company_id = :cid
                AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to ${visitUserFilter}`;

            // Solo visitas REALES (no las paradas 'pending' planificadas sin visitar).
            const VISITS_WHERE = `${PERIODO_WHERE} AND sv.status IN ('visited', 'completed')`;

            // La JORNADA: paradas que se crearon al iniciar la ruta, en cualquier estado. Es la
            // base de la cobertura. Se exige `route_id` porque una visita suelta (fuera de ruta)
            // fue real, pero nadie la había programado.
            const JORNADA_WHERE = `${PERIODO_WHERE} AND sv.route_id IS NOT NULL`;
            const CUADRE_SALES_WHERE = `sa.company_id = :cid AND sa.deleted_at IS NULL AND sa.status = 'completed'
                AND (sa.sale_date AT TIME ZONE :tz)::date BETWEEN :from AND :to ${saleUserFilter}`;

            // Resumen general (respeta filtro de vendedor si aplica).
            const [resumen] = await sequelize.query(
                `SELECT COUNT(*)::int AS visitas,
                        COUNT(*) FILTER (WHERE sv.sale_amount > 0)::int AS con_venta,
                        COUNT(*) FILTER (WHERE sv.sale_amount = 0)::int AS sin_venta,
                        COALESCE(SUM(sv.sale_amount), 0)::float8 AS total_vendido
                 FROM store_visits sv JOIN stores st ON st.id = sv.store_id
                 WHERE ${VISITS_WHERE}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // 🗺️ COBERTURA — sale de la JORNADA REAL, no del calendario de la ruta.
            //
            // Antes se calculaba desde `routes.working_days` + `routes_stores` + `routes.user_id`,
            // es decir desde el estado de HOY. Eso producía dos mentiras:
            //   1. Días sin jornada con tiendas "programadas" y "sin visitar" en rojo (nadie
            //      inició la ruta: no había nada programado ni nada incumplido).
            //   2. Las paradas se le cargaban al encargado ACTUAL de la ruta aunque el período
            //      fuera de meses atrás y la hubiera trabajado otra persona.
            // Ahora "programada" = existe la fila en `store_visits`, y "sin visitar" = esa fila
            // sigue en 'pending'. Si no se programó nada, sale cero.
            const [cobertura] = await sequelize.query(
                `SELECT COUNT(*)::int AS programadas,
                        COUNT(*) FILTER (WHERE sv.status IN ('visited', 'completed'))::int AS visitadas,
                        COUNT(*) FILTER (WHERE sv.status = 'pending')::int AS no_visitadas,
                        COUNT(DISTINCT sv.route_id)::int AS num_rutas
                 FROM store_visits sv JOIN stores st ON st.id = sv.store_id
                 WHERE ${JORNADA_WHERE}`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Desglose por vendedor: actividad y cobertura en la MISMA consulta, agrupando por
            // `sv.user_id`. Antes eran dos consultas de fuentes distintas fusionadas en JS, y por
            // eso salían filas de vendedores con 0 visitas y decenas de tiendas "sin visitar".
            const porVendedor = await sequelize.query(
                `SELECT sv.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        COUNT(*) FILTER (WHERE sv.route_id IS NOT NULL)::int AS programadas,
                        COUNT(*) FILTER (WHERE sv.route_id IS NOT NULL AND sv.status = 'pending')::int AS no_visitadas,
                        COUNT(*) FILTER (WHERE sv.status IN ('visited', 'completed'))::int AS visitas,
                        COUNT(*) FILTER (WHERE sv.status IN ('visited', 'completed') AND sv.sale_amount > 0)::int AS con_venta,
                        COUNT(*) FILTER (WHERE sv.status IN ('visited', 'completed') AND sv.sale_amount = 0)::int AS sin_venta,
                        COALESCE(SUM(sv.sale_amount) FILTER (WHERE sv.status IN ('visited', 'completed')), 0)::float8 AS total_vendido
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 JOIN users u ON u.id = sv.user_id
                 WHERE ${PERIODO_WHERE}
                 GROUP BY sv.user_id, nombre
                 ORDER BY total_vendido DESC, programadas DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Cuadre por método de pago: cuánto cobrar en cada uno (fuente: ventas).
            const porMetodoPago = await sequelize.query(
                `SELECT pm.id AS payment_method_id, pm.name AS nombre,
                        COUNT(*)::int AS num_ventas,
                        COALESCE(SUM(sa.total_amount), 0)::float8 AS total
                 FROM sales sa JOIN payment_methods pm ON pm.id = sa.payment_method_id
                 WHERE ${CUADRE_SALES_WHERE}
                 GROUP BY pm.id, pm.name ORDER BY total DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Detalle: una fila por visita, con su resultado (venta o motivo de no-venta).
            // En las visitas SIN venta se adjunta `estimado_perdido`: lo que esa tienda
            // suele comprar, para poder mostrarlo en rojo en la tabla.
            const detalle = await sequelize.query(
                `WITH ${CTE_REFERENCIA_TIENDA}
                 SELECT sv.id AS visit_id, sv.date AS fecha,
                        COALESCE(sv.store_name, st.name) AS store_name,
                        sv.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS vendedor,
                        sa.id AS sale_id, sa.total_amount::float8 AS total,
                        pm.name AS payment_method,
                        rs.name AS no_sale_reason, c.name AS no_sale_category,
                        CASE WHEN sa.id IS NULL THEN ref.promedio::float8 END AS estimado_perdido
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 JOIN users u ON u.id = sv.user_id
                 LEFT JOIN sales sa ON sa.visit_id = sv.id AND sa.deleted_at IS NULL AND sa.status = 'completed'
                 LEFT JOIN payment_methods pm ON pm.id = sa.payment_method_id
                 -- 🚫 El motivo solo se enseña si el reporte sigue VIVO. La condición va en el ON
                 -- y no en el WHERE: en un LEFT JOIN, filtrar fuera lo vuelve INNER y
                 -- desaparecerían las visitas que nunca tuvieron reporte (§14.7).
                 LEFT JOIN store_no_sale_reports nsr ON nsr.visit_id = sv.id AND nsr.annulled_at IS NULL
                 LEFT JOIN no_sale_reasons rs ON rs.id = nsr.reason_id
                 LEFT JOIN no_sale_categories c ON c.id = nsr.category_id
                 LEFT JOIN referencia ref ON ref.store_id = sv.store_id
                 WHERE ${VISITS_WHERE}
                 ORDER BY sv.date DESC
                 LIMIT 2000`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    user_id: userId,
                    resumen: { ...resumen, num_ventas: resumen.con_venta },
                    cobertura,
                    por_vendedor: porVendedor,
                    por_metodo_pago: porMetodoPago,
                    detalle,
                    detalle_truncado: detalle.length >= 2000,
                },
            });
        } catch (error) {
            console.error('Error en getCuadre:', error);
            return res.status(500).json({ success: false, message: 'Error al obtener el cuadre de ventas' });
        }
    },

    /**
     * 📌 GET /api/sales/reports/lost-opportunity?from&to&user_id
     * Oportunidad perdida del período: no-ventas (se visitó y no compró) y
     * no-visitas (parada planificada que quedó `pending`), con una ESTIMACIÓN
     * de cuánto se dejó de vender. Por defecto HOY, igual que el Cuadre.
     *
     * ⚠️ La cifra es una ESTIMACIÓN, no una pérdida contable. La referencia de
     * cada tienda es su propio promedio de compra:
     *   - Preferente: promedio de los últimos 90 días, si tiene ≥2 ventas ahí
     *     (refleja precios y hábitos actuales).
     *   - Respaldo: promedio de todo su historial (tiendas de compra esporádica).
     * Solo se promedian visitas con venta > 0: incluir los ceros hundiría la
     * referencia hasta volverla inútil.
     * Las tiendas que nunca han comprado no tienen referencia; sus casos se
     * cuentan en `sin_referencia` y NO suman al estimado (ni se inflan ni se ocultan).
     *
     * ⚠️ `no_visitas` solo ve rutas que SÍ se iniciaron: las paradas se crean al
     * arrancar la ruta. Si un vendedor nunca la inició, esas tiendas no existen
     * como visita y quedan fuera. Por eso la cifra es siempre conservadora.
     */
    async getLostOpportunity(req, res) {
        try {
            const cid = req.user.companyId;
            const tz = req.user.companyTimezone || DEFAULT_TZ;

            // Mismo rango por defecto que el Cuadre: HOY (fecha local del negocio).
            const isValid = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
            let { from, to } = req.query;
            if (!isValid(from) || !isValid(to)) {
                const [t] = await sequelize.query(
                    `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
                    { type: QueryTypes.SELECT, replacements: { tz } }
                );
                const hoy = String(t.hoy).slice(0, 10);
                if (!isValid(from)) from = hoy;
                if (!isValid(to)) to = hoy;
            }

            const userId = req.query.user_id || null;
            const repl = { cid, tz, from, to, user_id: userId };
            const userFilter = userId ? 'AND sv.user_id = :user_id' : '';

            // La referencia por tienda es la misma que usa el detalle del Cuadre.
            const CTE_CASOS = `
                WITH ${CTE_REFERENCIA_TIENDA},
                casos AS (
                    SELECT sv.id AS visit_id, sv.store_id, sv.user_id,
                           st.name AS store_name,
                           CASE WHEN sv.status = 'pending' THEN 'no_visita' ELSE 'no_venta' END AS tipo,
                           nsr.category_id, nsr.reason_id,
                           ref.promedio AS estimado
                    FROM store_visits sv
                    JOIN stores st ON st.id = sv.store_id
                    -- 🚫 Mismo motivo que arriba: va en el ON para no volver INNER el LEFT y
                    -- perder las paradas pendientes, que no tienen reporte (§14.7).
                    LEFT JOIN store_no_sale_reports nsr ON nsr.visit_id = sv.id AND nsr.annulled_at IS NULL
                    LEFT JOIN referencia ref ON ref.store_id = sv.store_id
                    WHERE st.company_id = :cid
                      AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to
                      AND (
                            -- Se visitó pero no compró. Se aceptan los DOS estados:
                            -- 'visited' (histórico) y 'completed' (actual).
                            (sv.status IN ('visited', 'completed') AND COALESCE(sv.sale_amount, 0) = 0)
                            -- Parada planificada que nunca se hizo.
                            OR sv.status = 'pending'
                          )
                      ${userFilter}
                )
            `;

            // Resumen general del período.
            const [resumen] = await sequelize.query(
                `${CTE_CASOS}
                 SELECT COUNT(*)::int AS casos,
                        COUNT(*) FILTER (WHERE tipo = 'no_venta')::int AS no_ventas,
                        COUNT(*) FILTER (WHERE tipo = 'no_visita')::int AS no_visitas,
                        COUNT(*) FILTER (WHERE estimado IS NULL)::int AS sin_referencia,
                        COALESCE(SUM(estimado), 0)::float8 AS estimado_total,
                        COALESCE(AVG(estimado), 0)::float8 AS estimado_promedio
                 FROM casos`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Desglose por vendedor: dónde se concentra la pérdida.
            const porVendedor = await sequelize.query(
                `${CTE_CASOS}
                 SELECT c.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        COUNT(*)::int AS casos,
                        COUNT(*) FILTER (WHERE c.tipo = 'no_venta')::int AS no_ventas,
                        COUNT(*) FILTER (WHERE c.tipo = 'no_visita')::int AS no_visitas,
                        COUNT(*) FILTER (WHERE c.estimado IS NULL)::int AS sin_referencia,
                        COALESCE(SUM(c.estimado), 0)::float8 AS estimado_total,
                        COALESCE(AVG(c.estimado), 0)::float8 AS estimado_promedio
                 FROM casos c
                 JOIN users u ON u.id = c.user_id
                 GROUP BY c.user_id, u.first_name, u.last_name
                 ORDER BY estimado_total DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Desglose por motivo: qué hay que atacar.
            const porMotivo = await sequelize.query(
                `${CTE_CASOS}
                 SELECT COALESCE(cat.name, 'Sin categoría') AS categoria,
                        COALESCE(rs.name,
                                 CASE WHEN c.tipo = 'no_visita'
                                      THEN 'Visita planificada no realizada'
                                      ELSE 'Sin motivo registrado' END) AS motivo,
                        COUNT(*)::int AS casos,
                        COALESCE(SUM(c.estimado), 0)::float8 AS estimado_total
                 FROM casos c
                 LEFT JOIN no_sale_categories cat ON cat.id = c.category_id
                 LEFT JOIN no_sale_reasons rs ON rs.id = c.reason_id
                 GROUP BY 1, 2
                 ORDER BY estimado_total DESC, casos DESC
                 LIMIT 30`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Detalle de las visitas PLANIFICADAS QUE NO SE HICIERON (status 'pending').
            // Es la información que hoy no se ve en ningún otro sitio: el detalle del
            // Cuadre solo incluye visitas realizadas ('visited'/'completed').
            //
            // Se ordena por importe estimado, NO por fecha: con cientos de casos, lo
            // accionable es saber qué tiendas grandes se quedaron sin visitar, no en
            // qué orden ocurrió. `ultima_compra` distingue el descuido puntual del
            // cliente que se está perdiendo.
            const detalleNoVisitadas = await sequelize.query(
                `WITH ${CTE_REFERENCIA_TIENDA}
                 SELECT sv.id AS visit_id, sv.date AS fecha,
                        COALESCE(sv.store_name, st.name) AS store_name,
                        sv.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS vendedor,
                        COALESCE(sv.route_name, r.name) AS route_name,
                        ref.promedio::float8 AS estimado_perdido,
                        ref.ultima_compra
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 JOIN users u ON u.id = sv.user_id
                 LEFT JOIN routes r ON r.id = sv.route_id
                 LEFT JOIN referencia ref ON ref.store_id = sv.store_id
                 WHERE st.company_id = :cid
                   AND sv.status = 'pending'
                   AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to
                   ${userFilter}
                 ORDER BY ref.promedio DESC NULLS LAST, sv.date DESC
                 LIMIT 500`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            return res.status(200).json({
                success: true,
                data: {
                    range: { from, to },
                    user_id: userId,
                    resumen,
                    por_vendedor: porVendedor,
                    por_motivo: porMotivo,
                    detalle_no_visitadas: detalleNoVisitadas,
                    detalle_truncado: detalleNoVisitadas.length >= 500,
                },
            });
        } catch (error) {
            console.error('Error en getLostOpportunity:', error);
            return res.status(500).json({ success: false, message: 'Error al obtener la oportunidad perdida' });
        }
    },
};
