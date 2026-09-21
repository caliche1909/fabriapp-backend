/**
 * 🧱 Construcción de PARADAS (`store_visits`) — fuente única de la verdad.
 *
 * Una parada es una FOTO: congela el nombre y la dirección de la tienda, el nombre del
 * responsable y el nombre de la ruta tal como estaban el día de la jornada. Por eso el
 * histórico sobrevive a renombres, reasignaciones y borrados.
 *
 * Este helper existe para que TODOS los caminos que crean paradas —iniciar/programar una
 * ruta y ajustar una jornada ya abierta— generen filas idénticas. Duplicar este armado
 * es la forma más fácil de que una parada nazca a medias (sin `route_name`, o con `date`
 * en `now()` cuando la jornada es de un día futuro).
 */

/**
 * Arma UNA fila de `store_visits` en estado 'pending'.
 *
 * @param {object}  p
 * @param {object}  p.store        Tienda con { id, name, address }.
 * @param {object}  p.route        Ruta con { id, name }.
 * @param {string}  p.userId       UUID del responsable de la jornada (dueño de la lista).
 * @param {string?} p.userName     Nombre del responsable, desnormalizado en la parada.
 * @param {string}  p.visitDay     Día de la jornada, 'YYYY-MM-DD'.
 * @param {Date|string} p.fechaMarca  Valor para `date`: `now()` si la jornada es HOY, o la
 *        medianoche de ese día en la zona de la compañía si es futura. ⚠️ No es cosmético:
 *        los reportes filtran por `(date AT TIME ZONE tz)::date`, así que estampar `now()`
 *        en una lista programada para mañana la haría aparecer HOY como visita no realizada.
 * @param {'in-route'|'occasional'} [p.visitType='in-route']  De dónde salió la parada.
 *        `occasional` solo para las que agrega el vendedor sobre la marcha, cuya tienda NO
 *        pertenece a la ruta: es la marca que impide que el diagnóstico de "Ajustar" las
 *        confunda con paradas huérfanas y las ofrezca para borrar.
 */
const construirParada = ({ store, route, userId, userName, visitDay, fechaMarca, visitType = 'in-route' }) => ({
    user_id: userId,
    store_id: store.id,
    route_id: route.id,
    visit_day: visitDay,
    status: 'pending',
    distance: null,
    arrived_at: null,
    user_name: userName,
    store_name: store.name,
    store_address: store.address,
    route_name: route.name,
    sale_amount: 0.00,
    date: fechaMarca,
    visit_type: visitType,
});

/**
 * 🔐 ¿Puede este usuario operar sobre ESTA parada (marcarla, venderle, reportar no-venta)?
 *
 * 🧠 La regla cuelga de la **RUTA**, no de la fila: el permiso lo da ser el **encargado actual**
 * (`routes.user_id`), que es la asignación VIVA. Eso es lo que hace posible el relevo a media
 * jornada — si el vendedor se accidenta, se reasigna la ruta y el nuevo continúa desde donde
 * quedó, incluso sobre paradas que el anterior ya dejó en 'visited'.
 *
 * Si colgara de `store_visits.user_id`, esas paradas quedarían inalcanzables para el nuevo
 * encargado (y 'visited' no es un estado raro: ~31 % del histórico termina ahí).
 *
 * El OWNER no tiene excepción: para operar una ruta debe asignársela, que es justamente el
 * mecanismo del relevo. Así nunca hay dos personas moviendo la misma jornada.
 *
 * ⚠️ Caso de datos antiguos: hay paradas con `route_id NULL` (24 en dev). Sin ruta no hay
 * encargado que consultar, así que para esas se conserva la regla vieja —"la parada es tuya"—,
 * que es más estricta y no abre ningún hueco.
 *
 * @returns {Promise<{autorizado: boolean, mensaje: string|null}>} `mensaje` listo para el 403.
 */
const autorizarSobreLaVisita = async ({ visita, companyId, userId, transaction = null }) => {
    const { routes, users } = require('../models');

    if (!visita.route_id) {
        return visita.user_id === userId
            ? { autorizado: true, mensaje: null }
            : { autorizado: false, mensaje: 'Esta visita no te pertenece.' };
    }

    const ruta = await routes.findOne({
        where: { id: visita.route_id, company_id: companyId },
        attributes: ['id', 'user_id'],
        transaction,
    });

    if (!ruta) {
        return { autorizado: false, mensaje: 'La ruta de esta visita no existe en tu compañía.' };
    }
    if (!ruta.user_id) {
        return { autorizado: false, mensaje: 'Esta ruta no tiene un encargado asignado, así que nadie puede recorrerla.' };
    }
    if (ruta.user_id === userId) {
        return { autorizado: true, mensaje: null };
    }

    const encargado = await users.findByPk(ruta.user_id, { attributes: ['first_name', 'last_name'], transaction });
    const nombre = encargado ? `${encargado.first_name} ${encargado.last_name}`.trim() : 'otro vendedor';
    return {
        autorizado: false,
        mensaje: `Esta ruta está a cargo de ${nombre}. Solo su encargado actual puede operar sus visitas.`,
    };
};

/**
 * 🔐 ¿Puede este usuario OPERAR esta ruta? Misma regla que `autorizarSobreLaVisita`, pero
 * cuando todavía NO hay visita que autorizar —crear una parada ocasional, optimizar el
 * recorrido— y lo único que hay es la ruta.
 *
 * La regla es una sola y no admite excepciones: **operar una ruta = ser su encargado actual**.
 * Ni el owner ni `start_route_for_others` pasan por aquí. Quien quiera operarla tiene que
 * asignársela, que es exactamente el mecanismo del relevo: así la jornada siempre tiene un
 * dueño único y nunca hay dos personas moviéndola a la vez. Ver o iniciar es otra cosa y se
 * gobierna aparte.
 *
 * @param {object}  route   Ruta ya cargada (necesita `user_id`).
 * @param {string}  userId  Usuario que pide la acción.
 * @param {string}  accion  Cómo se nombra la acción en el 403 ("operarla", "optimizar el recorrido"…).
 * @returns {Promise<{autorizado: boolean, mensaje: string|null}>}
 */
const autorizarSobreLaRuta = async ({ route, userId, accion = 'operarla', transaction = null }) => {
    const { users } = require('../models');

    if (!route.user_id) {
        return { autorizado: false, mensaje: 'Esta ruta no tiene un encargado asignado, así que nadie puede recorrerla.' };
    }
    if (route.user_id === userId) {
        return { autorizado: true, mensaje: null };
    }

    const encargado = await users.findByPk(route.user_id, { attributes: ['first_name', 'last_name'], transaction });
    const nombre = encargado ? `${encargado.first_name} ${encargado.last_name}`.trim() : 'otro vendedor';
    return {
        autorizado: false,
        mensaje: `Esta ruta está a cargo de ${nombre}. Solo su encargado actual puede ${accion}. `
            + 'Para hacerlo tú, asígnate la ruta.',
    };
};

/**
 * 🚫 ¿La parada tiene un reporte de no compra VIVO? Una sola definición para las tres respuestas
 * que la llevan: las filas de `getRouteDayVisits` y `formatearParadaDelDia` (routes_controller)
 * y la proyección de la visita del día en `getStoresByRoute` (stores_controller).
 *
 * 🔴 Si alguien la copia en un controlador "para ajustarla un poco", el cajón y la tarjeta de
 * tienda acabarán ofreciendo cosas distintas para la misma parada.
 *
 * 🔴 SE MANDA DICHO, NO SE DEJA DEDUCIR. "`completed` con importe 0" coincide HOY con "tiene
 * reporte" —0 ventas de valor cero en toda la historia, medido el 2026-09-16—, pero el día que
 * exista una venta a $0 el teléfono tomaría esa parada vendida por una cerrada con reporte,
 * ofrecería anularlo y la degradaría a `visited`. Ver OFFLINE-CAMPO.md §14.9.
 *
 * `annulled_at IS NULL` es la mitad de la definición: un reporte anulado ya no cierra nada.
 * Espera el alias `store_visits`, que es el que Sequelize da a la tabla principal.
 */
const SQL_TIENE_REPORTE_VIVO = `EXISTS (SELECT 1 FROM store_no_sale_reports nsr
    WHERE nsr.visit_id = "store_visits"."id" AND nsr.annulled_at IS NULL)`;

/**
 * 🧭 ¿POR QUÉ esta tienda no tiene parada? — el motivo VERDADERO para el 409 de marcar.
 *
 * Hasta ahora todos los "no hay parada" contestaban lo mismo: **"Primero debes iniciar la ruta"**.
 * Con la ruta ya iniciada eso es FALSO, y es el consejo que empujó a un vendedor a buscarse la
 * vida por otro camino —la venta ocasional— hasta dejar cinco ventas sin parada el 15-sep. Son
 * tres situaciones distintas, con tres remedios distintos, y quien las lee está en la calle:
 *
 *   1. La ruta no tiene jornada ese día → iniciar la ruta. El mensaje de siempre, que ahí sí es cierto.
 *   2. Hay jornada y la tienda ES de la ruta → **`SIN_PARADA`**: se vinculó después de iniciarla.
 *      Se arregla con "Ajustar". Es exactamente lo que la tarjeta ya pinta como `sin_parada`
 *      (`getStoresByRoute`), y las dos definiciones tienen que decir lo mismo: "la ruta tiene al
 *      menos una parada ese día, y ninguna es de esta tienda".
 *   3. Hay jornada y la tienda YA NO es de la ruta → su lista está vieja; recargar.
 *
 * ⚠️ **Solo se diagnostica la jornada de HOY.** Un marcado que llega en diferido (`visit_day` de
 * ayer, la cola vaciándose a la mañana siguiente) no puede remitirse a "Ajustar": ese botón solo
 * toca de hoy en adelante, así que sería mandar al vendedor a un sitio donde su tienda no está.
 * Para esos días se conserva el mensaje de siempre. Ver OFFLINE-CAMPO.md §16.5.
 *
 * `routeId` puede faltar: un cliente viejo no lo manda. Sin él no se puede hablar de "esta ruta",
 * así que el caso 3 no se emite y el 2 se decide mirando TODAS las rutas de la tienda que tengan
 * jornada ese día — la misma pregunta, solo que sin poder nombrar la ruta.
 *
 * @param {object}  p
 * @param {number}  p.storeId    Tienda que se intentó marcar.
 * @param {number?} p.routeId    Ruta en cuyo contexto se marcó, si el cliente la mandó.
 * @param {string}  p.companyId  Compañía de la sesión (aísla la consulta).
 * @param {string}  p.visitDay   Día de negocio al que pertenece el trabajo, 'YYYY-MM-DD'.
 * @param {boolean} p.esDeHoy    Si ese día es HOY en la zona de la compañía.
 * @returns {Promise<{code: string, message: string}>} Listo para el cuerpo del 409.
 */
const diagnosticarFaltaDeParada = async ({
    storeId, routeId = null, companyId, visitDay, esDeHoy = true,
}) => {
    const { sequelize } = require('../models');
    const { CODIGOS } = require('./sincronizacion');

    const deSiempre = {
        code: CODIGOS.VISITA_NO_EXISTE,
        message: esDeHoy
            ? 'Esta tienda no tiene visitas pendientes para el día de hoy. Primero debes iniciar la ruta.'
            : `Esta tienda no tenía una visita programada el ${visitDay}.`,
    };

    if (!esDeHoy) return deSiempre;

    // Los `CAST(:x AS ...)` en lugar de `:x::tipo` son la costumbre de este código: el `::` de
    // Postgres y los `:parametros` de Sequelize se confunden entre sí.
    // Con `routeId` nulo, `v.route_id = NULL` no es cierto para ninguna fila, así que
    // `hay_jornada` sale en falso y el caso 3 no se emite — que es justo lo que se quiere.
    const [fila] = await sequelize.query(
        `SELECT
             EXISTS (
                 SELECT 1
                   FROM store_visits v
                   JOIN routes r ON r.id = v.route_id AND r.company_id = :cia
                  WHERE v.route_id = CAST(:rid AS integer)
                    AND v.visit_day = CAST(:dia AS date)
             ) AS hay_jornada,
             EXISTS (
                 SELECT 1
                   FROM routes_stores rs
                  WHERE rs.store_id = CAST(:sid AS integer)
                    AND rs.company_id = :cia
                    AND (CAST(:rid AS integer) IS NULL OR rs.route_id = CAST(:rid AS integer))
                    AND EXISTS (
                        SELECT 1 FROM store_visits v2
                         WHERE v2.route_id = rs.route_id
                           AND v2.visit_day = CAST(:dia AS date)
                    )
             ) AS es_miembro_con_jornada`,
        {
            type: sequelize.QueryTypes.SELECT,
            replacements: { sid: storeId, rid: routeId ?? null, cia: companyId, dia: visitDay },
        }
    );

    if (fila && fila.es_miembro_con_jornada) {
        return {
            code: CODIGOS.SIN_PARADA,
            message: 'Esta tienda se agregó a la ruta después de iniciarla, así que hoy no tiene '
                + 'visita programada. Usa el botón "Ajustar" de la ruta para agregarla a la jornada '
                + 'y podrás marcarla.',
        };
    }

    if (fila && fila.hay_jornada) {
        return {
            code: CODIGOS.VISITA_NO_EXISTE,
            message: 'Esta tienda ya no pertenece a esta ruta, así que hoy no tiene visita '
                + 'programada. Recarga la ruta para ver su lista al día.',
        };
    }

    return deSiempre;
};

module.exports = {
    construirParada,
    autorizarSobreLaVisita,
    autorizarSobreLaRuta,
    diagnosticarFaltaDeParada,
    SQL_TIENE_REPORTE_VIVO,
};
