/**
 * 🔁 Contrato de sincronización — piezas compartidas por los tres endpoints de campo
 * (`createSale`, `updateStoreAsVisited`, `createNoSaleReport`).
 *
 * Existe para que las tres operaciones que el vendedor hace en la calle se comporten IGUAL cuando
 * llegan tarde o repetidas. Ver `OFFLINE-CAMPO.md` §6.
 *
 * Todo lo de aquí es **opcional**: si la petición no trae estos campos, los controladores se
 * comportan exactamente como siempre. Es lo que permite subir el backend antes que el frontend.
 */

/**
 * Ventana en la que se acepta la hora que declara el cliente.
 *
 * 🔴 El reloj del teléfono puede estar mal — ya nos pasó con el día hábil, que se calculaba con la
 * zona del dispositivo y mentía. Aquí el riesgo es peor: una hora inventada entra al histórico y
 * descuadra los reportes. Así que se acota:
 *
 *   - Nada del FUTURO más allá de un margen pequeño (relojes que van adelantados unos minutos).
 *   - Nada más viejo que 36 h. Cubre de sobra la jornada más larga imaginable (salir a las 5 a.m. y
 *     sincronizar a la mañana siguiente) sin abrir la puerta a que un teléfono con la fecha del año
 *     pasado meta una venta en un periodo ya cerrado.
 *
 * Fuera de la ventana **no se rechaza la operación** —el trabajo se hizo de verdad y perderlo sería
 * peor— sino que se cae a la hora del servidor y la fila queda marcada como diferida.
 */
const MARGEN_FUTURO_MS = 5 * 60 * 1000;        // 5 minutos
const VENTANA_MAXIMA_MS = 36 * 60 * 60 * 1000; // 36 horas

/**
 * A partir de cuánto retraso se considera que la operación NO llegó en vivo.
 * Por debajo de esto, `synced_at` queda NULL: es una operación normal, con la latencia de siempre.
 */
const UMBRAL_DIFERIDO_MS = 2 * 60 * 1000;      // 2 minutos

/**
 * Códigos ESTABLES de respuesta. La cola del cliente decide con esto, no con el texto en español.
 *
 * La pregunta que TODOS tienen que ayudar a responder es una sola:
 * **¿pauso la cola y pido reautenticación, descarto la operación, o reintento más tarde?**
 */
const CODIGOS = {
    // ── Autenticación (los emite `jwt.middleware.js`) ────────────────────────────────────
    // 🔴 Ojo: este backend responde **403 para todos ellos**, nunca 401. Sin estos códigos, la
    // cola no puede distinguir "se caducó la sesión" (pausar y reautenticar) de "no tienes ese
    // permiso" (descartar): los dos llegan como 403 con un texto en español que puede cambiar.
    SESION_AUSENTE: 'SESION_AUSENTE',       // no se mandó cabecera Authorization → reautenticar
    SESION_EXPIRADA: 'SESION_EXPIRADA',     // TokenExpiredError → PAUSAR la cola y reautenticar
    SESION_INVALIDA: 'SESION_INVALIDA',     // firma mala o token corrupto → reautenticar
    SESION_REVOCADA: 'SESION_REVOCADA',     // ya no es miembro activo de la compañía → reautenticar
    SIN_PERMISO: 'SIN_PERMISO',             // le falta el permiso → DESCARTAR, no reintentar nunca

    // ── Operaciones de campo (los emiten los controladores) ──────────────────────────────
    // Éxitos que parecen errores. La cola los da por buenos y saca la operación de la lista.
    YA_REGISTRADO: 'YA_REGISTRADO',             // mismo client_operation_id: es nuestro propio reintento
    VISITA_YA_CERRADA: 'VISITA_YA_CERRADA',     // la parada ya estaba visited/completed

    // 🧾 La venta LLEGÓ, pero ya no cabía: se guardó APARTADA (`deleted_at` + `conflict_reason`).
    //
    // 🔴 Para la cola esto es una ENTREGA, no un fallo: la operación está en Postgres, que es la
    // única condición para sacarla de la cola. Pero el cliente tiene trabajo pendiente —devolver
    // el stock que descontó, recargar la ruta y avisar al vendedor—, porque la parada NO quedó
    // cerrada con esa venta y el teléfono está pintando algo que no es. Ver OFFLINE-CAMPO.md §11.
    REGISTRADA_CON_CONFLICTO: 'REGISTRADA_CON_CONFLICTO',

    // Rechazos de verdad: hay que contárselos al vendedor, no reintentar.
    NO_ES_ENCARGADO: 'NO_ES_ENCARGADO',
    PRODUCTO_NO_DISPONIBLE: 'PRODUCTO_NO_DISPONIBLE',
    VISITA_NO_EXISTE: 'VISITA_NO_EXISTE',
    VENTA_YA_REGISTRADA: 'VENTA_YA_REGISTRADA', // ya hay venta para esa visita (bloquea el no-venta)
    NO_VENTA_YA_REGISTRADA: 'NO_VENTA_YA_REGISTRADA',
    DATOS_INVALIDOS: 'DATOS_INVALIDOS',

    // ── Rechazos REPARABLES ──────────────────────────────────────────────────────────────
    //
    // 🔴 Estos tres son distintos de los de arriba y por eso van aparte: **una persona puede
    // arreglarlos y entonces la MISMA operación sale bien**. Reabrir la bodega, asignarle una al
    // vendedor o reponer existencias no cambia la venta, solo el obstáculo.
    //
    // El cliente NO los descarta: deja la operación pendiente con el motivo a la vista y un botón
    // para reintentar. Descartarlas sería lo peor de todo cuando hubo dinero de por medio: la
    // venta ya ocurrió y el vendedor ya cobró; el registro tiene que acabar existiendo.
    SIN_BODEGA: 'SIN_BODEGA',                   // el vendedor no tiene bodega asignada
    BODEGA_NO_OPERATIVA: 'BODEGA_NO_OPERATIVA', // existe pero está inactiva o cerrada
    STOCK_INSUFICIENTE: 'STOCK_INSUFICIENTE',   // no alcanza el saldo (reponer y reintentar)
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee y valida los campos de sincronización del cuerpo de la petición.
 *
 * @returns {{ ok: true, clientOperationId: string|null, occurredAt: Date|null, syncedAt: Date|null,
 *             visitDay: string|null }}
 *          | {{ ok: false, message: string }}  ← el controlador responde 400 con este mensaje
 */
const leerCamposDeSincronizacion = (body = {}, ahora = new Date()) => {
    // ── client_operation_id ──────────────────────────────────────────────────────────────
    let clientOperationId = null;
    if (body.client_operation_id != null && body.client_operation_id !== '') {
        const valor = String(body.client_operation_id);
        if (!RE_UUID.test(valor)) {
            return { ok: false, message: 'client_operation_id debe ser un UUID válido.' };
        }
        clientOperationId = valor.toLowerCase();
    }

    // ── occurred_at ──────────────────────────────────────────────────────────────────────
    // Se acota a la ventana razonable; fuera de ella se usa la hora del servidor (ver arriba).
    let occurredAt = null;
    let syncedAt = null;
    if (body.occurred_at != null && body.occurred_at !== '') {
        const declarada = new Date(body.occurred_at);
        if (Number.isNaN(declarada.getTime())) {
            return { ok: false, message: 'occurred_at debe ser una fecha ISO válida.' };
        }

        const desfase = ahora.getTime() - declarada.getTime();
        const dentroDeLaVentana = desfase >= -MARGEN_FUTURO_MS && desfase <= VENTANA_MAXIMA_MS;

        occurredAt = dentroDeLaVentana ? declarada : ahora;
        // Se marca como diferida siempre que el cliente diga que pasó hace rato, y también cuando
        // la hora declarada era disparatada: si el reloj miente, saber que llegó en diferido es lo
        // único que queda para explicar el dato.
        if (!dentroDeLaVentana || desfase > UMBRAL_DIFERIDO_MS) syncedAt = ahora;
    }

    // ── visit_day ────────────────────────────────────────────────────────────────────────
    // El día de negocio al que pertenece el trabajo, capturado en el cliente al hacerlo. Sin esto,
    // sincronizar pasada la medianoche rechazaría la jornada entera (el servidor recalcula "hoy").
    let visitDay = null;
    if (body.visit_day != null && body.visit_day !== '') {
        const valor = String(body.visit_day);
        if (!RE_FECHA.test(valor) || Number.isNaN(new Date(`${valor}T12:00:00Z`).getTime())) {
            return { ok: false, message: 'visit_day debe tener el formato YYYY-MM-DD.' };
        }
        visitDay = valor;
    }

    return { ok: true, clientOperationId, occurredAt, syncedAt, visitDay };
};

/**
 * Busca una operación ya registrada por su UUID de cliente.
 *
 * 🔴 `paranoid: false` NO es opcional. `sales` tiene borrado lógico: una venta ANULADA sigue
 * ocupando su fila y su UUID en el índice único, pero el `findOne` normal no la ve. Sin esto, el
 * reintento de una venta anulada no encontraría nada, intentaría insertar y **chocaría contra el
 * índice con un 500**. Con esto responde "ya registrado", que es la verdad: esa operación ya se
 * procesó, y que después la anularan es otra historia.
 * En los modelos que no son paranoid la opción se ignora sin efecto.
 */
const buscarOperacionPrevia = async (Modelo, clientOperationId, { transaction = null } = {}) => {
    if (!clientOperationId) return null;
    return Modelo.findOne({
        where: { client_operation_id: clientOperationId },
        paranoid: false,
        transaction,
    });
};

/**
 * ¿Este error es el choque del índice único de idempotencia?
 *
 * Ocurre solo en la carrera de dos peticiones idénticas simultáneas (el vendedor toca dos veces, o
 * la cola reintenta mientras el primer envío seguía vivo). El `SELECT` previo no las ve porque
 * ninguna ha hecho commit todavía.
 *
 * ⚠️ Al atraparlo **hay que hacer rollback antes de leer nada**: en Postgres una sentencia fallida
 * aborta la transacción entera y cualquier consulta posterior devuelve "transacción abortada".
 * La relectura va en una transacción NUEVA.
 */
const esChoqueDeIdempotencia = (error) =>
    Boolean(error && error.original && error.original.code === '23505'
        && String(error.original.constraint || '').includes('client_operation_id'));

module.exports = {
    CODIGOS,
    UMBRAL_DIFERIDO_MS,
    VENTANA_MAXIMA_MS,
    MARGEN_FUTURO_MS,
    leerCamposDeSincronizacion,
    buscarOperacionPrevia,
    esChoqueDeIdempotencia,
};
