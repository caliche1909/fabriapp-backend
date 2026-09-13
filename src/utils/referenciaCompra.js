/**
 * REFERENCIA DE COMPRA POR TIENDA — la ÚNICA definición de "cuánto suele comprar".
 *
 * 🔴 POR QUÉ VIVE AQUÍ Y NO DENTRO DE UN CONTROLADOR. La usan dos sitios muy distintos:
 * los informes de ventas (Cuadre y oportunidad perdida) y la lista de tiendas de una ruta,
 * que la enseña en la tarjeta de cada tienda.
 *
 * Si cada uno tuviera su copia, el día que alguien ajuste los 90 días, el `n >= 2` o el
 * `sale_amount > 0` —cosas que ya se han planteado— cambiaría uno y el otro se quedaría.
 * Y entonces el supervisor vería un número en el informe y el vendedor otro en la tarjeta,
 * **con el mismo nombre**. Eso no se descubre revisando: se sufre cuadrando caja.
 *
 * Medido el 2026-09-12 sobre la copia de producción: las dos definiciones plausibles
 * —ventana de 90 días frente a histórico completo— difieren en una **mediana del 8,8 %**, y
 * 88 de 189 tiendas por encima del 10 %. No es un matiz.
 */

/**
 * 📐 REFERENCIA DE COMPRA POR TIENDA — cuánto suele comprar cada tienda.
 *
 * Es la base para estimar lo que se dejó de vender cuando una tienda no compra o
 * no se visita. Se usa tanto en el detalle del Cuadre como en la sección de
 * oportunidad perdida, por eso vive aquí y no dentro de un handler.
 *
 * Criterio: promedio de los ÚLTIMOS 90 DÍAS si la tienda tiene al menos 2 ventas
 * ahí (refleja precios y hábitos actuales); si no, el promedio de todo su
 * historial (tiendas de compra esporádica). Solo se promedian visitas con venta
 * > 0: incluir los ceros hundiría la referencia hasta volverla inútil.
 *
 * Las tiendas que NUNCA han comprado no aparecen aquí: al hacer LEFT JOIN quedan
 * con `promedio` NULL, y quien consuma esto debe contarlas aparte (no estimarlas).
 *
 * Requiere los replacements :cid, :tz y :to. Se inserta tras un `WITH`.
 *
 * ⚡ `soloRuta` acota la agregación a las tiendas de UNA ruta (exige también :rid). No cambia
 * ni un valor —el promedio de una tienda solo depende de sus propias filas, así que filtrar
 * las demás no la toca—, pero evita agregar las 409 tiendas de la compañía para enseñar 45.
 * Medido el 2026-09-12: **48 ms → 20 ms**, y se comprobó fila a fila que los 44 promedios
 * salen idénticos. Es la misma definición, no una variante: por eso el filtro se inyecta en un
 * solo sitio y no hay dos SQL que mantener.
 *
 * NOTA 1: se usa CAST(:to AS date) y no `:to::date` para no confundir al parser de
 * replacements de Sequelize con el `::` de PostgreSQL.
 *
 * ⚠️ NOTA 2 — `AS MATERIALIZED` NO ES DECORATIVO. Desde PostgreSQL 12 los CTE
 * referenciados una sola vez se inlinean, y aquí el planificador elegía un nested
 * loop que **recalculaba esta referencia una vez por cada fila** del resultado
 * (888 iteraciones medidas → 602 ms). Forzando la materialización se computa una
 * sola vez y el plan pasa a hash join: **40 ms, 15× más rápido**. Si algún día se
 * quita esta palabra, el rendimiento se desploma en silencio.
 */
function cteReferenciaTienda({ soloRuta = false } = {}) {
    const deLaRuta = soloRuta
        ? 'AND sv.store_id IN (SELECT store_id FROM routes_stores WHERE route_id = :rid)'
        : '';
    return `
    ref_reciente AS (
        SELECT sv.store_id, AVG(sv.sale_amount) AS promedio, COUNT(*)::int AS n
        FROM store_visits sv
        JOIN stores st ON st.id = sv.store_id
        WHERE st.company_id = :cid ${deLaRuta}
          AND sv.sale_amount > 0
          AND (sv.date AT TIME ZONE :tz)::date
              BETWEEN (CAST(:to AS date) - INTERVAL '90 days') AND CAST(:to AS date)
        GROUP BY sv.store_id
    ),
    ref_historica AS (
        SELECT sv.store_id,
               AVG(sv.sale_amount) AS promedio,
               MAX(sv.date) AS ultima_compra
        FROM store_visits sv
        JOIN stores st ON st.id = sv.store_id
        WHERE st.company_id = :cid ${deLaRuta} AND sv.sale_amount > 0
        GROUP BY sv.store_id
    ),
    referencia AS MATERIALIZED (
        SELECT h.store_id,
               CASE WHEN r.n >= 2 THEN r.promedio ELSE h.promedio END AS promedio,
               CASE WHEN r.n >= 2 THEN 'reciente' ELSE 'historico' END AS origen,
               h.ultima_compra
        FROM ref_historica h
        LEFT JOIN ref_reciente r ON r.store_id = h.store_id
    )
`;
}

/** La forma SIN acotar, que es la que usan los informes. Misma definición, sin filtro de ruta. */
const CTE_REFERENCIA_TIENDA = cteReferenciaTienda();


/**
 * Cuánto suele comprar cada tienda de UNA ruta, como `Map(store_id -> {promedio, ultima_compra})`.
 *
 * Lo consume la lista de tiendas de la ruta para pintarlo en cada tarjeta. Va aquí, y no en el
 * controlador, para que use exactamente el mismo SQL que los informes.
 *
 * ⚠️ Una tienda que NUNCA ha comprado **no sale en el mapa**. No es lo mismo que comprar cero, y
 * quien lo pinte tiene que distinguirlo: enseñar "$0" afirmaría que no compra nada cuando lo
 * cierto es que no sabemos. Lo dice también la documentación del CTE de arriba.
 *
 * Medido el 2026-09-12 sobre la copia de producción: 45-74 ms para una ruta de 45 tiendas, con
 * 18.541 visitas en la tabla. Es una vez al abrir la ruta, no una por tarjeta.
 */
async function referenciaDeRuta(sequelize, { routeId, companyId, tz }) {
    const [{ hoy }] = await sequelize.query(
        `SELECT (now() AT TIME ZONE :tz)::date AS hoy`,
        { type: sequelize.QueryTypes.SELECT, replacements: { tz } },
    );

    const filas = await sequelize.query(
        `WITH ${cteReferenciaTienda({ soloRuta: true })}
         SELECT rs.store_id,
                ROUND(ref.promedio)::float8 AS promedio,
                ref.ultima_compra
           FROM routes_stores rs
           JOIN referencia ref ON ref.store_id = rs.store_id
          WHERE rs.route_id = :rid`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { cid: companyId, tz, to: hoy, rid: routeId },
        },
    );

    return new Map(filas.map((f) => [f.store_id, {
        promedio: f.promedio,
        ultima_compra: f.ultima_compra,
    }]));
}

module.exports = { CTE_REFERENCIA_TIENDA, referenciaDeRuta };
