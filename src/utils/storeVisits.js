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

module.exports = { construirParada, autorizarSobreLaVisita, autorizarSobreLaRuta };
