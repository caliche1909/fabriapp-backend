// 🧭 Motor de optimización de recorrido (heurística propia, sin servicios pagos).
// - Distancia en LÍNEA RECTA (haversine) — suficiente para reparto urbano.
// - Orden: vecino más cercano encadenado desde el GPS + pulido 2-opt.
// - Horarios: parseo de ventanas 12h ("07:00am,03:00pm") para clasificar tiendas
//   en abierta / abre más tarde / cerrada según la hora actual.

/** "07:00am" → minutos desde medianoche (0..1439). null si no parsea. */
function parseTime12h(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
    const m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h === 12) h = 0;            // 12am→0, 12pm→12 (tras el +12)
    if (m[3] === 'pm') h += 12;
    return h * 60 + min;
}

/** Une opening/closing (posiblemente con varias ventanas por coma) → [{open, close}]. */
function parseWindows(openingStr, closingStr) {
    if (!openingStr || !closingStr) return [];
    const opens = String(openingStr).split(',').map((x) => parseTime12h(x));
    const closes = String(closingStr).split(',').map((x) => parseTime12h(x));
    const n = Math.min(opens.length, closes.length);
    const windows = [];
    for (let i = 0; i < n; i++) {
        const o = opens[i];
        const c = closes[i];
        if (o == null || c == null) continue;
        if (c <= o) continue; // ventana inválida / nocturna: se ignora
        windows.push({ open: o, close: c });
    }
    return windows;
}

/** Clasifica una tienda a la hora `nowMin`. Sin horario válido ⇒ se asume abierta. */
function classify(windows, nowMin) {
    if (!windows.length) return { estado: 'abierta', abreA: null };
    for (const w of windows) {
        if (nowMin >= w.open && nowMin < w.close) return { estado: 'abierta', abreA: null };
    }
    const laters = windows.filter((w) => w.open > nowMin).map((w) => w.open).sort((a, b) => a - b);
    if (laters.length) return { estado: 'abre_mas_tarde', abreA: laters[0] };
    return { estado: 'cerrada', abreA: null };
}

/** minutos → "HH:MM". */
function formatMinutes(min) {
    if (min == null) return null;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Distancia en metros (haversine) entre {lat,lng}. */
function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

/** Distancia total de un recorrido origin → p1 → p2 → ... */
function totalDistance(origin, order) {
    let d = 0;
    let prev = origin;
    for (const p of order) {
        d += haversine(prev, p);
        prev = p;
    }
    return d;
}

/** Vecino más cercano encadenado desde `origin`. */
function nearestNeighbor(origin, points) {
    const remaining = points.slice();
    const order = [];
    let cur = origin;
    while (remaining.length) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const d = haversine(cur, remaining[i]);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        const next = remaining.splice(bestIdx, 1)[0];
        order.push(next);
        cur = next;
    }
    return order;
}

/** Pulido 2-opt: descruza tramos para acortar el total. Origen fijo. */
function twoOpt(origin, order) {
    let best = order.slice();
    let bestLen = totalDistance(origin, best);
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 60) {
        improved = false;
        for (let i = 0; i < best.length - 1; i++) {
            for (let k = i + 1; k < best.length; k++) {
                const candidate = best.slice(0, i)
                    .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
                const len = totalDistance(origin, candidate);
                if (len + 1e-6 < bestLen) {
                    best = candidate;
                    bestLen = len;
                    improved = true;
                }
            }
        }
    }
    return best;
}

/**
 * Optimiza el recorrido de las tiendas ABIERTAS desde el origen (GPS).
 * `stores`: [{ ..., lat, lng }]. Devuelve el orden (vecino más cercano + 2-opt).
 * Las que no tengan coordenadas se devuelven al final (sin distancia).
 */
function optimizeOpenStores(origin, stores) {
    const withCoords = stores.filter((s) => s.lat != null && s.lng != null);
    const withoutCoords = stores.filter((s) => s.lat == null || s.lng == null);
    const ordered = twoOpt(origin, nearestNeighbor(origin, withCoords));

    const recorrido = [];
    let prev = origin;
    ordered.forEach((s, idx) => {
        const d = haversine(prev, s);
        recorrido.push({ ...s, seq: idx + 1, distancia_desde_anterior_m: Math.round(d) });
        prev = s;
    });
    withoutCoords.forEach((s) => {
        recorrido.push({ ...s, seq: recorrido.length + 1, distancia_desde_anterior_m: null });
    });
    const distancia_total_m = Math.round(totalDistance(origin, ordered));
    return { recorrido, distancia_total_m };
}

module.exports = {
    parseTime12h,
    parseWindows,
    classify,
    formatMinutes,
    haversine,
    nearestNeighbor,
    twoOpt,
    optimizeOpenStores,
};
