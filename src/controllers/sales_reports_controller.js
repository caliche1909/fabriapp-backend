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

// Zona horaria del negocio para agrupar y filtrar por día/mes/año.
// (Colombia). Si el negocio opera en otra zona, cámbiala aquí.
const TZ = 'America/Bogota';

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
async function resolveRange(companyId, from, to) {
    const isValid = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (isValid(from) && isValid(to)) {
        return { from, to };
    }
    const [row] = await sequelize.query(
        `SELECT MIN(sale_date AT TIME ZONE :tz)::date AS min, MAX(sale_date AT TIME ZONE :tz)::date AS max
         FROM sales WHERE company_id = :cid AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT, replacements: { cid: companyId, tz: TZ } }
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

module.exports = {
    /**
     * 📌 GET /api/sales/reports/summary?from&to
     * KPIs generales + top vendedores y tiendas para el Dashboard.
     */
    async getSummary(req, res) {
        try {
            const cid = req.user.companyId;
            const { from, to } = await resolveRange(cid, req.query.from, req.query.to);
            const repl = { cid, tz: TZ, from, to };

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
            const { from, to } = await resolveRange(cid, req.query.from, req.query.to);
            const g = GRANULARITIES[req.query.granularity] || GRANULARITIES.month;
            const repl = { cid, tz: TZ, from, to };

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
    async getSalesList(req, res) {
        try {
            const cid = req.user.companyId;
            const { from, to } = await resolveRange(cid, req.query.from, req.query.to);
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
            const offset = (page - 1) * limit;

            // Filtros opcionales adicionales.
            const filters = [];
            const repl = { cid, tz: TZ, from, to, limit, offset };
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
     * 📌 GET /api/sales/reports/no-sale?from&to
     * Reportes de no-venta agregados por categoría y por razón.
     */
    async getNoSaleReport(req, res) {
        try {
            const cid = req.user.companyId;
            const { from, to } = await resolveRange(cid, req.query.from, req.query.to);
            const repl = { cid, tz: TZ, from, to };
            const WHERE = `r.company_id = :cid AND (r.created_at AT TIME ZONE :tz)::date BETWEEN :from AND :to`;

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
            const { from, to } = await resolveRange(cid, req.query.from, req.query.to);

            // Paginación con topes defensivos.
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
            const offset = (page - 1) * limit;

            // Filtros opcionales (todos parametrizados para evitar inyección).
            const { categoryId, reasonId, sellerId, storeId } = req.query;
            const repl = { cid, tz: TZ, from, to, limit, offset };
            let WHERE = `r.company_id = :cid AND (r.created_at AT TIME ZONE :tz)::date BETWEEN :from AND :to`;
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
     * Lista de vendedores (miembros activos de la compañía) para los selectores.
     */
    async getSellers(req, res) {
        try {
            const cid = req.user.companyId;
            const sellers = await sequelize.query(
                `SELECT u.id AS user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre
                 FROM user_companies uc
                 JOIN users u ON u.id = uc.user_id
                 WHERE uc.company_id = :cid AND uc.status = 'active'
                 ORDER BY nombre`,
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

            // Rango por defecto: HOY (fecha local del negocio).
            const isValid = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
            let { from, to } = req.query;
            if (!isValid(from) || !isValid(to)) {
                const [t] = await sequelize.query(
                    `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
                    { type: QueryTypes.SELECT, replacements: { tz: TZ } }
                );
                const hoy = String(t.hoy).slice(0, 10);
                if (!isValid(from)) from = hoy;
                if (!isValid(to)) to = hoy;
            }

            const userId = req.query.user_id || null;
            const repl = { cid, tz: TZ, from, to, user_id: userId };

            // Filtros por vendedor (opcionales) para visitas y ventas.
            const visitUserFilter = userId ? 'AND sv.user_id = :user_id' : '';
            const saleUserFilter = userId ? 'AND sa.user_id = :user_id' : '';
            // Para la cobertura de rutas el vendedor es el ASIGNADO a la ruta (routes.user_id).
            const routeUserFilter = userId ? 'AND r.user_id = :user_id' : '';

            // Solo visitas REALES (no las paradas 'pending' planificadas sin visitar).
            const VISITS_WHERE = `st.company_id = :cid
                AND sv.status IN ('visited', 'completed')
                AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to ${visitUserFilter}`;
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

            // Desglose por vendedor (cuánto vendió cada uno en el período).
            const porVendedor = await sequelize.query(
                `SELECT sv.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        COUNT(*)::int AS visitas,
                        COUNT(*) FILTER (WHERE sv.sale_amount > 0)::int AS con_venta,
                        COUNT(*) FILTER (WHERE sv.sale_amount = 0)::int AS sin_venta,
                        COALESCE(SUM(sv.sale_amount), 0)::float8 AS total_vendido
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 JOIN users u ON u.id = sv.user_id
                 WHERE ${VISITS_WHERE}
                 GROUP BY sv.user_id, nombre ORDER BY total_vendido DESC`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // 🗺️ COBERTURA DE RUTAS
            // "Rutas del período" = rutas cuyos working_days incluyen alguno de los días
            // de la semana cubiertos por [from, to]. Las tiendas de esas rutas son las que
            // "debían visitarse"; se marcan como visitadas si tuvieron ≥1 visita en el rango.
            // El vendedor de cada tienda es el ASIGNADO a su ruta (routes.user_id).
            const COBERTURA_CTE = `
                WITH dias AS (
                    SELECT DISTINCT CASE trim(to_char(d, 'ID'))
                        WHEN '1' THEN 'lunes' WHEN '2' THEN 'martes' WHEN '3' THEN 'miercoles'
                        WHEN '4' THEN 'jueves' WHEN '5' THEN 'viernes' WHEN '6' THEN 'sabado'
                        WHEN '7' THEN 'domingo' END AS dia
                    FROM generate_series(:from::date, :to::date, interval '1 day') d
                ),
                rutas_periodo AS (
                    SELECT r.id, r.user_id
                    FROM routes r
                    WHERE r.company_id = :cid AND r.deleted_at IS NULL
                      AND r.working_days::text[] && (SELECT array_agg(dia) FROM dias)
                      ${routeUserFilter}
                ),
                tiendas_prog AS (
                    -- La relación tienda↔ruta vive en routes_stores (M2M); stores.route_id
                    -- se eliminó en la Fase 7. Cada par (tienda, ruta activa del período) es
                    -- una parada programada, con el vendedor asignado a esa ruta.
                    SELECT rs.store_id AS store_id, rp.user_id AS seller_id
                    FROM routes_stores rs
                    JOIN rutas_periodo rp ON rp.id = rs.route_id
                    JOIN stores s ON s.id = rs.store_id
                    WHERE s.deleted_at IS NULL
                ),
                marcadas AS (
                    SELECT tp.store_id, tp.seller_id,
                        EXISTS (SELECT 1 FROM store_visits sv
                                WHERE sv.store_id = tp.store_id
                                  AND sv.status IN ('visited', 'completed')
                                  AND (sv.date AT TIME ZONE :tz)::date BETWEEN :from AND :to) AS visitada
                    FROM tiendas_prog tp
                )`;

            const [coberturaResumen] = await sequelize.query(
                `${COBERTURA_CTE}
                 SELECT COUNT(*)::int AS programadas,
                        COUNT(*) FILTER (WHERE visitada)::int AS visitadas,
                        COUNT(*) FILTER (WHERE NOT visitada)::int AS no_visitadas,
                        (SELECT COUNT(*)::int FROM rutas_periodo) AS num_rutas
                 FROM marcadas`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            const coberturaVendedor = await sequelize.query(
                `${COBERTURA_CTE}
                 SELECT m.seller_id AS user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS nombre,
                        COUNT(*)::int AS programadas,
                        COUNT(*) FILTER (WHERE m.visitada)::int AS visitadas,
                        COUNT(*) FILTER (WHERE NOT m.visitada)::int AS no_visitadas
                 FROM marcadas m LEFT JOIN users u ON u.id = m.seller_id
                 WHERE m.seller_id IS NOT NULL
                 GROUP BY m.seller_id, nombre`,
                { type: QueryTypes.SELECT, replacements: repl }
            );

            // Fusionar actividad de ventas (porVendedor) con cobertura de rutas por vendedor.
            const vendedorMap = new Map();
            for (const v of porVendedor) {
                vendedorMap.set(v.user_id, {
                    user_id: v.user_id, nombre: v.nombre,
                    visitas: v.visitas, con_venta: v.con_venta, sin_venta: v.sin_venta,
                    total_vendido: v.total_vendido, programadas: 0, no_visitadas: 0,
                });
            }
            for (const c of coberturaVendedor) {
                const cur = vendedorMap.get(c.user_id) || {
                    user_id: c.user_id, nombre: c.nombre,
                    visitas: 0, con_venta: 0, sin_venta: 0, total_vendido: 0,
                    programadas: 0, no_visitadas: 0,
                };
                cur.nombre = cur.nombre || c.nombre;
                cur.programadas = c.programadas;
                cur.no_visitadas = c.no_visitadas;
                vendedorMap.set(c.user_id, cur);
            }
            const porVendedorMerged = [...vendedorMap.values()].sort(
                (a, b) => (b.total_vendido - a.total_vendido) || (b.programadas - a.programadas)
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
            const detalle = await sequelize.query(
                `SELECT sv.id AS visit_id, sv.date AS fecha,
                        COALESCE(sv.store_name, st.name) AS store_name,
                        sv.user_id,
                        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS vendedor,
                        sa.id AS sale_id, sa.total_amount::float8 AS total,
                        pm.name AS payment_method,
                        rs.name AS no_sale_reason, c.name AS no_sale_category
                 FROM store_visits sv
                 JOIN stores st ON st.id = sv.store_id
                 JOIN users u ON u.id = sv.user_id
                 LEFT JOIN sales sa ON sa.visit_id = sv.id AND sa.deleted_at IS NULL AND sa.status = 'completed'
                 LEFT JOIN payment_methods pm ON pm.id = sa.payment_method_id
                 LEFT JOIN store_no_sale_reports nsr ON nsr.visit_id = sv.id
                 LEFT JOIN no_sale_reasons rs ON rs.id = nsr.reason_id
                 LEFT JOIN no_sale_categories c ON c.id = nsr.category_id
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
                    cobertura: coberturaResumen,
                    por_vendedor: porVendedorMerged,
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
};
