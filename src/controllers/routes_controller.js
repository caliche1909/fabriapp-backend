const { routes, users, user_companies, roles, stores, route_types, store_visits } = require('../models');
const { parseWindows, classify, formatMinutes, optimizeOpenStores } = require('../utils/routeOptimization');
const { Op } = require('sequelize');
const { construirParada, autorizarSobreLaRuta } = require('../utils/storeVisits');

/**
 * 📅 Horizonte máximo de planificación de rutas, en días.
 * Se puede iniciar una ruta para HOY o para cualquier día dentro de este horizonte
 * (planificar por adelantado). Nunca hacia el pasado. El mismo valor lo publica
 * `getRouteDayVisits` como `max_planificacion`, para que el calendario del frontend
 * no pueda ofrecer una fecha que el backend rechazaría.
 */
const MAX_DIAS_PLANIFICACION = 30;

/**
 * Valida que una cadena sea una fecha real en formato YYYY-MM-DD.
 * El formato solo no basta: '2026-02-31' pasa el regex pero al castear a `date`
 * PostgreSQL lanza un error que se vería como un 500.
 */
const esFechaValida = (texto) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [anio, mes, dia] = texto.split('-').map(Number);
    const prueba = new Date(Date.UTC(anio, mes - 1, dia));
    return prueba.getUTCFullYear() === anio
        && prueba.getUTCMonth() === mes - 1
        && prueba.getUTCDate() === dia;
};

/**
 * 🔐 ¿Puede este usuario tocar las paradas de una jornada ajena?
 *
 * Misma regla que gobierna "iniciar ruta", reutilizada a propósito para no inventar un
 * permiso nuevo: el owner, el dueño de la propia jornada, o quien tenga
 * `start_route_for_others` (que es exactamente el permiso de "preparar la lista de otro
 * vendedor"). ADMIN y VENTAS ya lo tienen; el vendedor que agrega tiendas a su propia ruta
 * entra por la rama de "es mi jornada".
 *
 * ⚠️ NO se revalida el día hábil: la jornada YA existe, así que esa validación ya ocurrió
 * al iniciarla (o el owner la saltó a propósito para una jornada extraordinaria). Volver a
 * exigirla haría imposible ajustar justo esos casos.
 *
 * 🚧 ESTA ES LA ÚNICA ESCRITURA SOBRE UNA JORNADA AJENA QUE SIGUE PERMITIDA, y es deliberado
 * (decisión del 2026-08-27). Todo lo demás —marcar, vender, reportar no-venta, optimizar y crear
 * una venta ocasional— exige ser el ENCARGADO ACTUAL de la ruta, vía `autorizarSobreLaVisita` /
 * `autorizarSobreLaRuta`, sin excepción para el owner: quien quiera operar una ruta se la asigna.
 *
 * La línea que las separa es OPERAR vs. REPARAR. Ajustar no recorre la ruta: repone las paradas
 * de tiendas que se vincularon DESPUÉS de iniciarla (el caso `sin_parada`, al que la propia UI
 * manda con "Usa 'Ajustar' para agregar la visita") y quita las de tiendas que se retiraron. Es
 * mantenimiento de la lista, del mismo lado que "iniciar", y se permite incluso con la ruta en
 * marcha porque es justo cuando hace falta.
 */
const puedeAjustarJornada = (req, jornadaUserId) => {
    if (req.user?.userType === 'owner') return true;
    if (jornadaUserId === req.user?.id) return true;
    return Array.isArray(req.user?.permissions) && req.user.permissions.includes('start_route_for_others');
};

/** Nombre completo del responsable, para desnormalizarlo en la parada. */
const nombreDelResponsable = async (userId, transaction = null) => {
    const u = await users.findByPk(userId, { attributes: ['first_name', 'last_name'], transaction });
    return u ? `${u.first_name} ${u.last_name}`.trim() : null;
};

/**
 * 🧾 Da a UNA parada exactamente la misma forma que las filas de `getRouteDayVisits`, para que
 * el frontend pueda insertarla en la lista del cajón sin recargar la jornada entera.
 *
 * El estado por horario (abierta / abre más tarde / cerrada) depende de la HORA, así que se
 * calcula aquí con la zona de la compañía —igual que en el listado— y no se deja al cliente,
 * que usaría la zona del dispositivo y podría discrepar.
 */
const formatearParadaDelDia = async (visita, tz) => {
    const tienda = await stores.findByPk(visita.store_id, {
        attributes: [
            'opening_time', 'closing_time',
            [routes.sequelize.fn('ST_Y', routes.sequelize.col('ubicacion')), 'latitude'],
            [routes.sequelize.fn('ST_X', routes.sequelize.col('ubicacion')), 'longitude'],
        ],
        raw: true,
    });
    const [{ nowmin }] = await routes.sequelize.query(
        `SELECT EXTRACT(HOUR FROM (now() AT TIME ZONE :tz)) * 60
              + EXTRACT(MINUTE FROM (now() AT TIME ZONE :tz)) AS nowmin`,
        { type: routes.sequelize.QueryTypes.SELECT, replacements: { tz } }
    );

    let estado = null;
    let abre_a = null;
    if (visita.status === 'pending') {
        const c = classify(parseWindows(tienda?.opening_time, tienda?.closing_time), Number(nowmin));
        estado = c.estado;
        if (c.estado === 'abre_mas_tarde') abre_a = formatMinutes(c.abreA);
    }

    return {
        visit_id: visita.id,
        store_id: visita.store_id,
        store_name: visita.store_name,
        store_address: visita.store_address,
        status: visita.status,
        arrived_at: visita.arrived_at,
        sale_amount: Number(visita.sale_amount) || 0,
        optimized_seq: visita.optimized_seq,
        visit_type: visita.visit_type,
        latitude: tienda?.latitude != null ? Number(tienda.latitude) : null,
        longitude: tienda?.longitude != null ? Number(tienda.longitude) : null,
        estado,
        abre_a,
        // 🕗 Los horarios EN CRUDO, además del veredicto ya calculado.
        //
        // `estado` y `abre_a` se resuelven aquí arriba comparando contra `now()`, así que son un
        // dato con fecha de caducidad: valen para la respuesta de este instante. En cuanto la
        // jornada se guarde en el navegador para trabajar sin conexión, ese veredicto quedaría
        // **congelado a la hora de iniciar la ruta** — una tienda que abre a las 9 diría "abre más
        // tarde" a las 4 de la tarde, y el cajón de visitas, que ORDENA por ese campo, dejaría la
        // lista clavada al amanecer.
        //
        // Con las ventanas horarias crudas el cliente recalcula el estado con la hora actual
        // (misma lógica portada de `utils/routeOptimization`: parseWindows + classify). Es la
        // misma decisión que ya tomamos con el día hábil en `client/src/utils/diaHabil.ts`:
        // el servidor manda el dato, el cliente saca la conclusión.
        //
        // Aditivo: quien no los use ve exactamente lo mismo que antes.
        opening_time: tienda?.opening_time ?? null,
        closing_time: tienda?.closing_time ?? null,
    };
};

/**
 * 🧮 Calcula la desincronización entre la ruta y cada una de sus jornadas ABIERTAS
 * (desde HOY hasta HOY + MAX_DIAS_PLANIFICACION). Los días pasados no se tocan: el
 * histórico está cerrado.
 *
 * Devuelve un arreglo de jornadas; cada una con sus `faltantes`, `sobrantes` y `bloqueadas`.
 * Es pura lectura, y la comparten el diagnóstico (GET) y la aplicación (POST) para que el
 * ajuste se aplique exactamente sobre lo que el usuario vio.
 *
 * 🔑 Una jornada se identifica por **DÍA**, no por (día, persona).
 *
 * Agrupar por persona era correcto cuando la lista era de alguien, pero tras un **relevo** las
 * paradas de un mismo día quedan repartidas entre el vendedor anterior (las que resolvió) y el
 * nuevo (las pendientes que se le traspasaron). Agrupando por persona, el mismo día salía DOS
 * veces y **cada tienda aparecía como "faltante" para el bloque de quien no la tenía**: con 47
 * tiendas, el botón mostraba 47 ajustes fantasma y no había forma de resolverlos (el UNIQUE
 * `(store_id, route_id, visit_day)` impide crearlas, así que aplicar no cambiaba nada).
 *
 * El responsable de la jornada es el **encargado ACTUAL de la ruta** (`routes.user_id`): es quien
 * debe hacer lo que falta, y a su nombre nacen las paradas nuevas — coherente con el traspaso de
 * pendientes que hace `updateRoute`. Si la ruta no tiene encargado (dato viejo), se cae al usuario
 * con más paradas ese día para que el diagnóstico siga siendo utilizable.
 */
const construirDiagnosticoDeAjuste = async ({ rid, companyId, tz, transaction = null }) => {
    const opciones = { type: routes.sequelize.QueryTypes.SELECT, transaction };
    const reemplazos = { rid, company: companyId, tz, horizonte: MAX_DIAS_PLANIFICACION };

    // Jornadas abiertas + `fecha_marca` de cada una (now() si es hoy; medianoche en la zona
    // de la compañía si es futura), con la MISMA regla que usa `startRoute`.
    const jornadas = await routes.sequelize.query(
        `WITH ref AS (SELECT (now() AT TIME ZONE :tz)::date AS hoy),
              dias AS (
                  SELECT sv.visit_day,
                         -- Respaldo por si la ruta se quedó sin encargado: quien más paradas tiene.
                         mode() WITHIN GROUP (ORDER BY sv.user_id) AS user_frecuente
                    FROM store_visits sv, ref
                   WHERE sv.route_id = :rid
                     AND sv.visit_day >= ref.hoy
                     AND sv.visit_day <= ref.hoy + CAST(:horizonte AS integer)
                   GROUP BY sv.visit_day
              )
         SELECT to_char(d.visit_day, 'YYYY-MM-DD') AS visit_day,
                (d.visit_day = ref.hoy) AS es_hoy,
                CASE WHEN d.visit_day = ref.hoy THEN now()
                     ELSE CAST(d.visit_day AS timestamp) AT TIME ZONE :tz END AS fecha_marca,
                COALESCE(r.user_id, d.user_frecuente) AS user_id,
                NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS user_name
           FROM dias d
           CROSS JOIN ref
           JOIN routes r ON r.id = :rid
           LEFT JOIN users u ON u.id = COALESCE(r.user_id, d.user_frecuente)
          ORDER BY d.visit_day ASC`,
        { ...opciones, replacements: reemplazos }
    );

    if (jornadas.length === 0) return [];

    // FALTANTES: tiendas VIVAS vinculadas a la ruta que no tienen parada ese día.
    // `s.deleted_at IS NULL` es clave: `deleteStore` hace soft delete y NO limpia
    // `routes_stores`, así que una tienda eliminada sigue figurando como miembro. Crearle
    // una parada sería resucitarla dentro de la jornada.
    const faltantes = await routes.sequelize.query(
        `WITH ref AS (SELECT (now() AT TIME ZONE :tz)::date AS hoy),
              dias AS (
                  SELECT DISTINCT sv.visit_day
                    FROM store_visits sv, ref
                   WHERE sv.route_id = :rid
                     AND sv.visit_day >= ref.hoy
                     AND sv.visit_day <= ref.hoy + CAST(:horizonte AS integer)
              )
         SELECT to_char(d.visit_day, 'YYYY-MM-DD') AS visit_day,
                s.id AS store_id, s.name AS store_name, s.address AS store_address
           FROM dias d
           JOIN routes_stores rs ON rs.route_id = :rid AND rs.company_id = :company
           JOIN stores s ON s.id = rs.store_id AND s.deleted_at IS NULL
          WHERE NOT EXISTS (
                    -- Sin filtro por usuario: la parada existe o no existe, da igual a nombre
                    -- de quién quedó. Con el filtro por persona, tras un relevo TODA tienda
                    -- de la ruta parecía faltar.
                    SELECT 1 FROM store_visits v
                     WHERE v.route_id = :rid AND v.store_id = s.id
                       AND v.visit_day = d.visit_day)
          ORDER BY d.visit_day ASC, s.name ASC`,
        { ...opciones, replacements: reemplazos }
    );

    // HUÉRFANAS: paradas de la jornada cuya tienda ya no pertenece a la ruta, o fue
    // eliminada. Las 'pending' son accionables (`sobrantes`); las que ya avanzaron a
    // 'visited'/'completed' NO se tocan jamás (`bloqueadas`): pueden tener una venta o un
    // reporte de no-venta enganchado, y `sales.visit_id` está en ON DELETE SET NULL, así
    // que borrarlas desengancharía la venta en silencio en vez de fallar.
    const huerfanas = await routes.sequelize.query(
        `WITH ref AS (SELECT (now() AT TIME ZONE :tz)::date AS hoy)
         SELECT to_char(sv.visit_day, 'YYYY-MM-DD') AS visit_day,
                sv.id AS visit_id, sv.store_id, sv.store_name, sv.status,
                (s.id IS NULL OR s.deleted_at IS NOT NULL) AS tienda_eliminada
           FROM store_visits sv
           LEFT JOIN stores s ON s.id = sv.store_id
           CROSS JOIN ref
          WHERE sv.route_id = :rid
            AND sv.visit_day >= ref.hoy
            AND sv.visit_day <= ref.hoy + CAST(:horizonte AS integer)
            -- 🏷️ Las paradas OCASIONALES quedan fuera del diagnóstico. Su tienda no pertenece
            -- a la ruta por definición, así que encajarían al milímetro en la condición de
            -- abajo y el diálogo las ofrecería para borrar con la casilla marcada. Se ven
            -- idénticas a una parada huérfana en los datos: esta marca es lo único que las
            -- distingue de una tienda que salió de la ruta con la jornada abierta.
            AND sv.visit_type <> 'occasional'
            AND (s.id IS NULL
                 OR s.deleted_at IS NOT NULL
                 OR NOT EXISTS (SELECT 1 FROM routes_stores rs
                                 WHERE rs.route_id = sv.route_id AND rs.store_id = sv.store_id))
          ORDER BY sv.visit_day ASC, sv.store_name ASC`,
        { ...opciones, replacements: reemplazos }
    );

    return jornadas.map((j) => {
        const suyas = huerfanas.filter((h) => h.visit_day === j.visit_day);

        return {
            visit_day: j.visit_day,
            es_hoy: j.es_hoy === true,
            fecha_marca: j.fecha_marca,
            responsable: { user_id: j.user_id, user_name: j.user_name },
            faltantes: faltantes
                .filter((f) => f.visit_day === j.visit_day)
                .map((f) => ({ store_id: f.store_id, store_name: f.store_name, store_address: f.store_address })),
            sobrantes: suyas
                .filter((h) => h.status === 'pending')
                .map((h) => ({
                    visit_id: h.visit_id,
                    store_id: h.store_id,
                    store_name: h.store_name,
                    status: h.status,
                    tienda_eliminada: h.tienda_eliminada === true,
                })),
            bloqueadas: suyas
                .filter((h) => h.status !== 'pending')
                .map((h) => ({
                    visit_id: h.visit_id,
                    store_id: h.store_id,
                    store_name: h.store_name,
                    status: h.status,
                    tienda_eliminada: h.tienda_eliminada === true,
                })),
        };
    });
};

// 🎯 Función helper para formatear datos del vendedor de forma consistente
const formatSellerData = (seller, assignment) => {
    if (!seller) return null;

    // Procesar el teléfono para separar código de país y número
    let countryCode = undefined;
    let phoneNumber = undefined;

    if (seller.phone) {
        if (seller.phone.includes('-')) {
            [countryCode, phoneNumber] = seller.phone.split('-');
        } else {
            phoneNumber = seller.phone;
        }
    }

    return {
        id: seller.id,
        email: seller.email,
        name: seller.first_name,
        lastName: seller.last_name,
        countryCode: countryCode,
        phone: phoneNumber,
        imageUrl: seller.image_url,
        imagePublicId: seller.image_public_id,
        userStatus: seller.status,
        role: assignment && assignment.role ? {
            id: assignment.role.id,
            name: assignment.role.name,
            label: assignment.role.label,
            description: assignment.role.description,
            isGlobal: assignment.role.is_global,
            isActive: assignment.role.is_active
        } : null,
        allowAccess: assignment ? assignment.status : null,
        userType: assignment ? assignment.user_type : null,
        requireGeolocation: seller.require_geolocation || false
    };
};

// 🎯 Función helper para obtener datos del vendedor con su rol
const getSellerWithRole = async (userId, companyId) => {
    if (!userId) return null;

    const sellerData = await users.findByPk(userId, {
        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status', 'image_url', 'image_public_id', 'require_geolocation'],
        include: [
            {
                model: user_companies,
                as: 'company_assignments',
                where: {
                    company_id: companyId,
                    status: 'active'
                },
                attributes: ['user_type', 'status'],
                include: [
                    {
                        model: roles,
                        as: 'role',
                        attributes: ['id', 'name', 'label', 'description', 'is_global', 'is_active']
                    }
                ],
                required: false
            }
        ],
        required: false
    });

    if (!sellerData) return null;

    const assignment = sellerData.company_assignments && sellerData.company_assignments.length > 0
        ? sellerData.company_assignments[0]
        : null;

    return formatSellerData(sellerData, assignment);
};

// 🎯 Validar que el vendedor asignado sea válido para la compañía (aislamiento multi-tenant).
// - Si no se envía vendedor (null/undefined) → válido (el vendedor es opcional).
// - Si se envía, debe:
//     (a) existir un vínculo ACTIVO en user_companies para esa compañía (membresía), y
//     (b) tener el usuario en estado global 'active' (users.status).
//   Si falla cualquiera, se rechaza (no confiar solo en el filtrado del cliente).
// Devuelve { valid: boolean, message?: string }.
const validateSellerInCompany = async (userId, companyId) => {
    if (!userId) return { valid: true };

    const membership = await user_companies.findOne({
        where: { user_id: userId, company_id: companyId, status: 'active' },
        attributes: ['id'],
        include: [{
            model: users,
            as: 'user',
            attributes: ['id', 'status']
        }]
    });

    if (!membership) {
        return {
            valid: false,
            message: "El vendedor seleccionado no pertenece a esta compañía o su vínculo está inactivo."
        };
    }

    if (membership.user && membership.user.status === 'inactive') {
        return {
            valid: false,
            message: "No puedes asignar un vendedor inactivo."
        };
    }

    return { valid: true };
};

module.exports = {

    // 📌 Método para obtener las rutas activas de una compañía
    // (paranoid: true automáticamente excluye rutas eliminadas)
    async getListRoutes(req, res) {

        try {
            // 🔒 Compañía SIEMPRE desde la sesión (no del path) → cierra IDOR multi-tenant.
            const company_id = req.user.companyId;
            const { permission_type } = req.query;


            // 🔹 Validar parámetro obligatorio
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se reconoce a la compañía",
                    routes: []
                });
            }

            // 🔹 Validar permission_type
            if (!permission_type || !['all_routes', 'assigned_routes'].includes(permission_type)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Tipo de permiso inválido",
                    routes: []
                });
            }

            // 🔹 Preparar condiciones de filtro según el tipo de permiso
            let whereConditions = {
                company_id: company_id
            };

            // 🔹 Si el permiso es solo rutas asignadas, filtrar por usuario actual
            if (permission_type === 'assigned_routes') {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({
                        success: false,
                        status: 401,
                        message: "Usuario no autenticado",
                        routes: []
                    });
                }
                whereConditions.user_id = userId;
            }

            // 🔹 Obtener rutas filtradas con información optimizada del vendedor
            const routesList = await routes.findAll({
                where: whereConditions,
                attributes: ['id', 'name', 'working_days', 'user_id', 'route_type_id'],
                include: [
                    {
                        model: users,
                        as: 'seller',
                        attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'status', 'image_url', 'image_public_id', 'require_geolocation'],
                        include: [
                            {
                                model: user_companies,
                                as: 'company_assignments',
                                where: {
                                    company_id: company_id,
                                    status: 'active'
                                },
                                attributes: ['user_type', 'status'],
                                include: [
                                    {
                                        model: roles,
                                        as: 'role',
                                        attributes: ['id', 'name', 'label', 'description', 'is_global', 'is_active']
                                    }
                                ],
                                required: false
                            }
                        ],
                        required: false
                    },
                    {
                        model: route_types,
                        as: 'route_type',
                        attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global'],
                        required: false
                    }
                ],
                order: [['created_at', 'DESC']]
            });

            // 🔹 Si no hay rutas, devolver lista vacía
            if (!routesList.length) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: permission_type === 'all_routes' ? "Su compañía aun no a creado rutas." : "No se encontraron rutas asignadas para este usuario",
                    routes: []
                });
            }

            // 📋 Formatear los datos de las rutas para el frontend
            const formattedRoutes = routesList.map(route => {
                const assignment = route.seller && route.seller.company_assignments && route.seller.company_assignments.length > 0
                    ? route.seller.company_assignments[0]
                    : null;

                return {
                    id: route.id,
                    name: route.name,
                    seller: route.seller ? formatSellerData(route.seller, assignment) : null,
                    working_days: route.working_days || [],
                    route_type_id: route.route_type_id || null,
                    route_type: route.route_type ? {
                        id: route.route_type.id,
                        name: route.route_type.name,
                        description: route.route_type.description,
                        color: route.route_type.color,
                        display_order: route.route_type.display_order,
                        is_active: route.route_type.is_active,
                        is_global: route.route_type.is_global
                    } : null
                    // ✅ NO incluimos stores según tu especificación
                };
            });


            res.status(200).json({
                success: true,
                status: 200,
                message: permission_type === 'all_routes' ? "Se han cargado todas las rutas de la compañía." : "Se han cargado las rutas asignadas a este usuario.",
                routes: formattedRoutes
            });

        } catch (error) {
            console.error("❌ Error al obtener rutas:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor",
                routes: []
            });
        }
    },

    // 📌 Método para eliminar una ruta (soft delete con auditoría)
    async deleteRoute(req, res) {
        // 🔄 Usar transacción para garantizar atomicidad entre deleted_by y destroy
        const transaction = await routes.sequelize.transaction();

        try {
            const { id } = req.params;
            const user_id = req.user?.id; // Usuario que hace la eliminación
            const companyId = req.user?.companyId; // 🔒 compañía del usuario autenticado (aislamiento multi-tenant)

            // 🔹 Verificar si la ruta existe (paranoid: true excluye ya eliminadas automáticamente)
            const route = await routes.findOne({ where: { id, company_id: companyId }, transaction });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta eliminar NO EXISTE o ya fue eliminada!"
                });
            }

            // 🔹 Verificar que la ruta no tenga tiendas vinculadas (validación de negocio).
            // El vínculo tienda↔ruta vive en routes_stores (M2M).
            const storesCount = await routes.sequelize.models.routes_stores.count({
                where: { route_id: id },
                transaction
            });

            if (storesCount > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: `No se puede eliminar la ruta porque tiene ${storesCount} tienda(s) asignada(s). Primero debe reasignar las tiendas.`
                });
            }

            // 🗑️ Soft delete con auditoría automática via hook
            await route.destroy({
                userId: user_id, // El hook beforeDestroy usará este valor para deleted_by
                transaction
            });

            // 🎯 Confirmar transacción
            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: "La ruta ha sido eliminada exitosamente."
            });

        } catch (error) {
            // 🔄 Rollback en caso de error
            await transaction.rollback();
            console.error("❌ Error al eliminar ruta:", error);

            // 🔍 Manejo específico del error de auditoría (cuando no hay userId)
            if (error.message.includes('Se requiere un userId')) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Error de auditoría: Usuario no identificado para la eliminación."
                });
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al eliminar la ruta."
            });
        }
    },

    // 📌 Método para crear una nueva ruta
    async createRoute(req, res) {

        try {
            const { company_id } = req.params;
            const { name, user_id, working_days, route_type_id } = req.body;



            // 🔹 Validaciones básicas
            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
                });
            }

            // 🔹 Debe tener al menos un día hábil (si no, la ruta nunca podría iniciarse — D1)
            if (!Array.isArray(working_days) || working_days.length === 0) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Debe seleccionar al menos un día de trabajo para la ruta"
                });
            }

            // 🔹 Normalizar el nombre de la ruta
            const normalizedName = name.trim().replace(/\s+/g, ' ');

            // 🔹 Verificar si la compañía existe
            if (!company_id) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "No se identifico su compañía"
                });
            }

            // 🔹 Validar que el vendedor (si se envió) pertenezca a la compañía (multi-tenant)
            const sellerCheck = await validateSellerInCompany(user_id, company_id);
            if (!sellerCheck.valid) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: sellerCheck.message
                });
            }

            // 🔹 Verificar si ya existe una ruta con el mismo nombre en la compañía (activa o eliminada)
            const existingRoute = await routes.findOne({
                where: {
                    name: normalizedName,
                    company_id
                },
                paranoid: false // Incluir rutas eliminadas en la búsqueda                
            });

            if (existingRoute) {
                // 🔸 CASO 1: Ruta activa (deleted_at es null)
                if (existingRoute.deleted_at === null) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: "Ya existe una ruta con ese nombre. Por favor elija uno diferente."
                    });
                }

                // 🔸 CASO 2: Ruta eliminada (deleted_at tiene valor) - RESTAURAR
                // ⚠️ IMPORTANTE: Ignorar vendedor anterior de la ruta eliminada
                // Solo asignar el nuevo user_id si viene en los datos, sino dejarlo en null
                existingRoute.user_id = user_id || null;
                existingRoute.working_days = working_days || [];
                existingRoute.route_type_id = route_type_id || null;

                // Usar el hook beforeRestore para limpiar campos de auditoría
                await existingRoute.restore();

                // 🔹 Recargar la ruta con el route_type incluido
                await existingRoute.reload({
                    include: [{
                        model: route_types,
                        as: 'route_type',
                        attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                    }]
                });

                // 🔹 Obtener los datos del vendedor solo si se asignó uno nuevo
                const sellerData = existingRoute.user_id ? await getSellerWithRole(existingRoute.user_id, company_id) : null;

                // 🔹 Formatear respuesta para el frontend
                const formattedRoute = {
                    id: existingRoute.id,
                    name: existingRoute.name,
                    seller: sellerData,
                    working_days: existingRoute.working_days || [],
                    route_type_id: existingRoute.route_type_id || null,
                    route_type: existingRoute.route_type ? {
                        id: existingRoute.route_type.id,
                        name: existingRoute.route_type.name,
                        description: existingRoute.route_type.description,
                        color: existingRoute.route_type.color,
                        display_order: existingRoute.route_type.display_order,
                        is_active: existingRoute.route_type.is_active,
                        is_global: existingRoute.route_type.is_global
                    } : null,
                    stores: []
                };

                return res.status(201).json({
                    success: true,
                    status: 201,
                    message: "Ruta restaurada exitosamente",
                    route: formattedRoute,
                    restored: true // Indicador de que fue restaurada
                });
            }

            // 🔹 Crear la nueva ruta
            const newRoute = await routes.create({
                name: normalizedName,
                company_id,
                user_id: user_id || null,
                working_days: working_days || [],
                route_type_id: route_type_id || null
            });

            // 🔹 Recargar la ruta con el route_type incluido
            await newRoute.reload({
                include: [{
                    model: route_types,
                    as: 'route_type',
                    attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                }]
            });

            // 🔹 Obtener los datos del vendedor si existe
            const sellerData = await getSellerWithRole(user_id, company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: newRoute.id,
                name: newRoute.name,
                seller: sellerData,
                working_days: newRoute.working_days || [],
                route_type_id: newRoute.route_type_id || null,
                route_type: newRoute.route_type ? {
                    id: newRoute.route_type.id,
                    name: newRoute.route_type.name,
                    description: newRoute.route_type.description,
                    color: newRoute.route_type.color,
                    display_order: newRoute.route_type.display_order,
                    is_active: newRoute.route_type.is_active,
                    is_global: newRoute.route_type.is_global
                } : null,
                stores: []
            };

            res.status(201).json({
                success: true,
                status: 201,
                message: "Ruta creada exitosamente",
                route: formattedRoute
            });

        } catch (error) {
            console.error("❌ Error al crear ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    // 📌 Método para actualizar una ruta
    async updateRoute(req, res) {

        try {
            const { id } = req.params;
            const { name, user_id, working_days, route_type_id } = req.body;
            const companyId = req.user?.companyId; // 🔒 compañía del usuario autenticado (aislamiento)

            if (!name) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "El nombre de la ruta es requerido"
                });
            }

            // 🔹 Si se envían días de trabajo, no pueden quedar vacíos (una ruta sin días
            //    hábiles nunca podría iniciarse — D1). Si no se envían, se conservan los actuales.
            if (working_days !== undefined && (!Array.isArray(working_days) || working_days.length === 0)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Debe seleccionar al menos un día de trabajo para la ruta"
                });
            }

            // 🔹 Normalizar el nombre de la ruta (consistente con createRoute)
            const normalizedName = name.trim().replace(/\s+/g, ' ');

            // 🔹 Buscar la ruta a actualizar, SCOPED a la compañía del usuario (evita IDOR
            //    multi-tenant: checkPermission valida el permiso, no la pertenencia del recurso).
            const route = await routes.findOne({ where: { id, company_id: companyId } });

            if (!route) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: "La ruta que intenta actualizar NO EXISTE!"
                });
            }

            // 🔹 Verificar que el nuevo nombre no colisione con OTRA ruta activa de la compañía
            //    (consistente con createRoute; excluye la propia ruta por id).
            const duplicateRoute = await routes.findOne({
                where: {
                    name: normalizedName,
                    company_id: companyId,
                    id: { [Op.ne]: route.id }
                }
            });

            if (duplicateRoute) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: "Ya existe una ruta con ese nombre. Por favor elija uno diferente."
                });
            }

            // 🔹 Validar que el vendedor (si se envió) pertenezca a la compañía de la ruta (multi-tenant)
            if (user_id) {
                const sellerCheck = await validateSellerInCompany(user_id, route.company_id);
                if (!sellerCheck.valid) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: sellerCheck.message
                    });
                }
            }

            // 🔄 RELEVO A MEDIA JORNADA. Se captura el encargado ANTERIOR antes de pisarlo:
            // si cambia, las paradas PENDIENTES de las jornadas ABIERTAS (hoy en adelante) pasan
            // al nuevo, y las ya resueltas se quedan con quien las resolvió.
            //
            // 🧠 Sin esto el modelo queda a medias: el nuevo encargado ya puede operar la ruta
            // (paso 1-3), pero lo que falta por hacer seguiría figurando a nombre del anterior, y
            // el reporte de **oportunidad perdida** —que cuenta las `pending` por `sv.user_id`—
            // le cargaría a él las tiendas que no alcanzó a visitar el que lo relevó.
            //
            // Los días PASADOS no se tocan nunca: son historia cerrada.
            const encargadoAnterior = route.user_id;
            const hayCambioDeEncargado = user_id !== undefined && user_id !== encargadoAnterior;

            const tx = await routes.sequelize.transaction();
            let paradasTraspasadas = 0;
            let pendientesHuerfanas = 0;

            try {
                // 🔹 Actualizar los campos
                route.name = normalizedName || route.name;
                route.user_id = user_id !== undefined ? user_id : route.user_id;
                route.working_days = working_days || route.working_days;
                route.route_type_id = route_type_id !== undefined ? route_type_id : route.route_type_id;

                await route.save({ transaction: tx });

                if (hayCambioDeEncargado && user_id) {
                    const nuevo = await users.findByPk(user_id, { attributes: ['first_name', 'last_name'], transaction: tx });
                    const nombreNuevo = nuevo ? `${nuevo.first_name} ${nuevo.last_name}`.trim() : null;
                    const tz = req.user?.companyTimezone || 'America/Bogota';

                    // No hace falta ningún guardia anti-colisión: desde la migración
                    // 20260818120000 el UNIQUE es `(store_id, route_id, visit_day)`, así que no
                    // pueden existir dos paradas de la misma tienda y día para cambiarles el dueño.
                    const [, meta] = await routes.sequelize.query(
                        `UPDATE store_visits sv
                            SET user_id = CAST(:nuevo AS uuid), user_name = :nombre, updated_at = now()
                          WHERE sv.route_id = :rid
                            AND sv.status = 'pending'
                            AND sv.visit_day >= (now() AT TIME ZONE :tz)::date
                            AND sv.user_id <> CAST(:nuevo AS uuid)`,
                        { replacements: { rid: route.id, nuevo: user_id, nombre: nombreNuevo, tz }, transaction: tx }
                    );
                    paradasTraspasadas = meta && typeof meta.rowCount === 'number' ? meta.rowCount : 0;
                }

                // Quitarle el encargado a una ruta con jornada abierta deja paradas que NADIE puede
                // atender (marcar/vender exigen ser el encargado). No se bloquea —desasignar puede
                // ser deliberado— pero se avisa en la respuesta.
                if (hayCambioDeEncargado && !user_id) {
                    const tz = req.user?.companyTimezone || 'America/Bogota';
                    const [{ n }] = await routes.sequelize.query(
                        `SELECT count(*)::int AS n FROM store_visits
                          WHERE route_id = :rid AND status = 'pending'
                            AND visit_day >= (now() AT TIME ZONE :tz)::date`,
                        { type: routes.sequelize.QueryTypes.SELECT, replacements: { rid: route.id, tz }, transaction: tx }
                    );
                    pendientesHuerfanas = n;
                }

                await tx.commit();
            } catch (e) {
                await tx.rollback();
                throw e;
            }

            // 🔹 Recargar la ruta con el route_type incluido
            await route.reload({
                include: [{
                    model: route_types,
                    as: 'route_type',
                    attributes: ['id', 'name', 'description', 'color', 'display_order', 'is_active', 'is_global']
                }]
            });

            // 🔹 Obtener los datos del vendedor actualizados si existe
            const sellerData = await getSellerWithRole(route.user_id, route.company_id);

            // 🔹 Formatear respuesta para el frontend
            const formattedRoute = {
                id: route.id,
                name: route.name,
                seller: sellerData,
                working_days: route.working_days || [],
                route_type_id: route.route_type_id || null,
                route_type: route.route_type ? {
                    id: route.route_type.id,
                    name: route.route_type.name,
                    description: route.route_type.description,
                    color: route.route_type.color,
                    display_order: route.route_type.display_order,
                    is_active: route.route_type.is_active,
                    is_global: route.route_type.is_global
                } : null
                // ✅ NO incluimos stores
            };

            // Mensaje: lo que pasó con la jornada en curso no puede quedar en silencio.
            let message = "Ruta actualizada exitosamente";
            if (paradasTraspasadas > 0) {
                message += `. Se traspasaron ${paradasTraspasadas} visita${paradasTraspasadas === 1 ? '' : 's'} pendiente${paradasTraspasadas === 1 ? '' : 's'} al nuevo encargado`;
            } else if (pendientesHuerfanas > 0) {
                message += `. ⚠️ La ruta quedó SIN encargado y tiene ${pendientesHuerfanas} visita${pendientesHuerfanas === 1 ? '' : 's'} pendiente${pendientesHuerfanas === 1 ? '' : 's'} que nadie podrá atender`;
            }

            res.status(200).json({
                success: true,
                status: 200,
                message,
                route: formattedRoute,
                // Detalle del relevo, por si el cliente quiere mostrarlo aparte del mensaje.
                relevo: hayCambioDeEncargado
                    ? { hubo_cambio: true, visitas_traspasadas: paradasTraspasadas, pendientes_sin_encargado: pendientesHuerfanas }
                    : { hubo_cambio: false, visitas_traspasadas: 0, pendientes_sin_encargado: 0 },
            });

        } catch (error) {
            console.error("❌ Error al actualizar ruta:", error);
            res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor"
            });
        }
    },

    /**
     * 🚀 INICIAR / PROGRAMAR RUTA — Reemplaza a "reiniciar ruta".
     * Crea las visitas (estado 'pending') para todas las tiendas de la ruta (vía
     * routes_stores) a nombre del usuario elegido y para el DÍA elegido. Idempotente:
     * el UNIQUE (store_id, route_id, user_id, visit_day) evita duplicados, así que
     * iniciar dos veces no reinicia el progreso.
     *
     * 📅 Fecha: `body.visit_day` (YYYY-MM-DD). Por defecto HOY. Se admite **hacia
     * adelante** hasta `MAX_DIAS_PLANIFICACION` para poder dejar la ruta programada
     * (ej.: el owner arma hoy la lista de mañana para un vendedor; mañana ese vendedor
     * no crea nada, se le devuelve la lista ya existente). Hacia atrás se rechaza:
     * no tiene sentido "planificar" el pasado.
     *
     * 👤 La jornada es SIEMPRE del vendedor asignado (`routes.user_id`): no se elige
     * destinatario. Quién puede pulsar iniciar:
     *   - El vendedor asignado, si el día elegido es hábil para la ruta.
     *   - El OWNER: cualquier ruta y cualquier día (única vía para una jornada extraordinaria).
     *   - Con `start_route_for_others`: la ruta de otro vendedor, pero solo en día hábil.
     *   - Ruta sin vendedor asignado: nadie.
     */
    async startRoute(req, res) {
        const transaction = await routes.sequelize.transaction();
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const isOwner = req.user?.userType === 'owner';
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            // Ruta de la compañía del usuario.
            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, transaction });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // 🔐 ¿A nombre de quién se crean las visitas? SIEMPRE del vendedor asignado a la
            // ruta (`routes.user_id`). No se elige destinatario: eso elimina de raíz la
            // ambigüedad de "¿de quién es esta lista?" y hace que la ruta y su responsable
            // sean una sola cosa.
            //
            // Quién puede pulsar iniciar:
            //   - El vendedor asignado, en un día hábil de la ruta.
            //   - El OWNER, cualquier ruta y cualquier día (preparar la jornada por adelantado).
            //   - Quien tenga `start_route_for_others`: puede preparar la ruta de OTRO vendedor,
            //     pero la lista se sigue creando a nombre del asignado, no del suyo.
            const effectiveUserId = route.user_id;
            if (!effectiveUserId) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false, status: 400,
                    message: 'Esta ruta no tiene un vendedor asignado. Asígnale uno antes de iniciarla.',
                });
            }

            const canStartForOthers = isOwner || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('start_route_for_others'));
            const esMiRuta = effectiveUserId === req.user.id;
            if (!esMiRuta && !canStartForOthers) {
                await transaction.rollback();
                return res.status(403).json({ success: false, status: 403, message: 'Solo el vendedor asignado puede iniciar esta ruta.' });
            }

            // El vendedor asignado debe seguir siendo miembro ACTIVO de la compañía: si se
            // desactivó, crear una jornada a su nombre dejaría paradas que nadie puede resolver.
            const member = await user_companies.findOne({
                where: { user_id: effectiveUserId, company_id: companyId, status: 'active' },
                transaction,
            });
            if (!member) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false, status: 400,
                    message: 'El vendedor asignado a esta ruta ya no pertenece a la empresa o está inactivo.',
                });
            }

            // 📅 Día objetivo. Por defecto HOY; se acepta una fecha futura para dejar la
            // ruta programada. El formato se valida antes de tocar la BD porque una fecha
            // inexistente ('2026-02-31') pasa el regex pero revienta al castear a `date`.
            const diaSolicitado = req.body?.visit_day ? String(req.body.visit_day) : null;
            if (diaSolicitado && !esFechaValida(diaSolicitado)) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Fecha inválida (formato esperado YYYY-MM-DD).' });
            }

            // Fecha del negocio (zona horaria de la compañía, Capa B) + día de la semana
            // DEL DÍA OBJETIVO (no del de hoy: si se programa el viernes, lo que importa
            // es que el viernes sea hábil).
            //
            // `fecha_marca` es lo que se guarda en `store_visits.date`:
            //   - si el día objetivo es HOY → `now()` (comportamiento de siempre);
            //   - si es futuro → medianoche de ese día en la zona de la compañía.
            // ⚠️ Esto NO es cosmético: los reportes filtran por `(date AT TIME ZONE tz)::date`
            // y cuentan las paradas 'pending' como "no visitadas". Estampar `now()` en una
            // lista programada para mañana la haría aparecer HOY como oportunidad perdida.
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ dia, weekday, fecha_marca, dias_desde_hoy }] = await routes.sequelize.query(
                `WITH ref AS (
                     SELECT (now() AT TIME ZONE :tz)::date AS hoy,
                            COALESCE(CAST(:dia AS date), (now() AT TIME ZONE :tz)::date) AS dia
                 )
                 SELECT to_char(hoy, 'YYYY-MM-DD') AS hoy,
                        to_char(dia, 'YYYY-MM-DD') AS dia,
                        (dia - hoy) AS dias_desde_hoy,
                        CASE trim(to_char(dia,'ID'))
                            WHEN '1' THEN 'lunes' WHEN '2' THEN 'martes' WHEN '3' THEN 'miercoles'
                            WHEN '4' THEN 'jueves' WHEN '5' THEN 'viernes' WHEN '6' THEN 'sabado'
                            WHEN '7' THEN 'domingo' END AS weekday,
                        CASE WHEN dia = hoy THEN now()
                             ELSE CAST(dia AS timestamp) AT TIME ZONE :tz END AS fecha_marca
                 FROM ref`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { tz, dia: diaSolicitado }, transaction }
            );

            const desfase = Number(dias_desde_hoy);
            if (desfase < 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'No se puede iniciar una ruta en una fecha pasada.' });
            }
            if (desfase > MAX_DIAS_PLANIFICACION) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: `Solo se puede programar hasta ${MAX_DIAS_PLANIFICACION} días por adelantado.` });
            }
            const esHoy = desfase === 0;

            // 🔁 Idempotencia explícita: si el vendedor asignado ya tiene visitas de esta ruta
            // ese día, se devuelve lo que ya existe y NO se crea una segunda lista de
            // pendientes. Es lo que permite programar hoy la ruta de mañana: mañana el vendedor
            // pulsa "iniciar" y recibe su jornada tal cual quedó.
            // La jornada es de la RUTA, no de una persona: basta con que EXISTA para ese día.
            // Antes se contaba solo la del vendedor asignado, así que tras un relevo el nuevo
            // encargado no la "veía" y caía en el 409 de más abajo.
            const yaIniciada = await store_visits.count({
                where: { route_id: rid, visit_day: dia },
                transaction,
            });
            if (yaIniciada > 0) {
                const tiendasEnRuta = await routes.sequelize.models.routes_stores.count({
                    where: { route_id: rid, company_id: companyId },
                    transaction,
                });
                await transaction.commit();
                return res.status(200).json({
                    success: true,
                    status: 200,
                    already_started: true,
                    message: esHoy
                        ? 'Esta ruta ya estaba iniciada hoy. Se devuelven las visitas existentes.'
                        : `Esta ruta ya estaba programada para el ${dia}. Se devuelven las visitas existentes.`,
                    route_id: rid,
                    visit_day: dia,
                    tiendas_en_ruta: tiendasEnRuta,
                    visitas_del_dia: yaIniciada,
                });
            }

            // 🚫 Ya no hace falta el chequeo de "otra lista del mismo día": una jornada por ruta
            // y día es ahora un invariante del MODELO (arriba se sale si ya existe, sin mirar de
            // quién es). Antes esto devolvía un 409 al nuevo encargado tras un relevo — le decía
            // que la ruta era de otro justo cuando acababa de recibirla.

            // 📆 El día objetivo debe ser hábil para la ruta. Solo el OWNER se salta esta regla
            // (es la vía de escape para una jornada extraordinaria). `start_route_for_others`
            // NO la salta: ese permiso habilita preparar la ruta de otro vendedor, no cambiar
            // los días en que la ruta opera.
            if (!isOwner) {
                const workingDays = route.working_days || [];
                if (!workingDays.includes(weekday)) {
                    await transaction.rollback();
                    const cuando = esHoy ? `Hoy (${weekday})` : `El ${dia} (${weekday})`;
                    return res.status(400).json({ success: false, status: 400, message: `${cuando} no es un día hábil de esta ruta.` });
                }
            }

            // Tiendas de la ruta (vía routes_stores) con datos para el snapshot.
            const memberStores = await stores.findAll({
                attributes: ['id', 'name', 'address'],
                include: [{
                    association: 'member_routes',
                    attributes: [],
                    through: { attributes: [] },
                    where: { id: rid },
                    required: true,
                }],
                transaction,
            });

            if (memberStores.length === 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La ruta no tiene tiendas para visitar.' });
            }

            // Nombre del usuario que resolverá las visitas, para desnormalizar en la parada.
            const solver = await users.findByPk(effectiveUserId, { attributes: ['first_name', 'last_name'], transaction });
            const solverName = solver ? `${solver.first_name} ${solver.last_name}`.trim() : null;

            // Crear las paradas del día en 'pending'. ignoreDuplicates → ON CONFLICT
            // DO NOTHING contra el UNIQUE diario (idempotente, no reinicia progreso).
            const rows = memberStores.map((s) => construirParada({
                store: s,
                route,
                userId: effectiveUserId,
                userName: solverName,
                visitDay: dia,
                fechaMarca: fecha_marca,
            }));
            await store_visits.bulkCreate(rows, { ignoreDuplicates: true, transaction });

            // Conteo real del día tras la creación idempotente.
            const totalDia = await store_visits.count({ where: { route_id: rid, visit_day: dia }, transaction });

            await transaction.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: esHoy
                    ? 'Ruta iniciada. Se generaron las visitas del día.'
                    : `Ruta programada para el ${dia}. Se generaron ${totalDia} visitas.`,
                route_id: rid,
                visit_day: dia,
                is_today: esHoy,
                tiendas_en_ruta: memberStores.length,
                visitas_del_dia: totalDia,
            });
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback();
            console.error("❌ Error al iniciar ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al iniciar la ruta.' });
        }
    },

    /**
     * 📋 GET /api/routes/:route_id/visits/today?date=YYYY-MM-DD
     * Visitas de un DÍA de una ruta (fuente del drawer de "Iniciar ruta").
     * Devuelve cuántas tiendas tiene la ruta, si ya está iniciada ese día, el resumen por
     * estado, la lista ordenada y quién es el responsable.
     *
     * 👤 La lista se identifica por **ruta + día**, no por usuario: una ruta tiene un solo
     * responsable por día. Así se sigue viendo el histórico aunque la ruta se reasigne a otro
     * vendedor (las listas viejas pertenecen a quien la llevaba entonces).
     *
     * Si la jornada es de otra persona, hace falta ser owner o tener `view_routes_by_company`
     * —el permiso de "ver todas las rutas de la empresa"— y **siempre en modo consulta**:
     * marcar/optimizar/vender sigue exigiendo ser el dueño de la visita.
     */
    async getRouteDayVisits(req, res) {
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, attributes: ['id', 'name', 'user_id', 'working_days'] });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // Fecha objetivo: por defecto HOY (día hábil del negocio, zona horaria de la compañía).
            // El calendario puede pedir otra fecha vía ?date=YYYY-MM-DD (el pasado es solo lectura).
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ hoy, tope, nowmin }] = await routes.sequelize.query(
                `SELECT to_char((now() AT TIME ZONE :tz)::date, 'YYYY-MM-DD') AS hoy,
                        to_char((now() AT TIME ZONE :tz)::date + CAST(:horizonte AS integer), 'YYYY-MM-DD') AS tope,
                        EXTRACT(HOUR FROM (now() AT TIME ZONE :tz)) * 60
                        + EXTRACT(MINUTE FROM (now() AT TIME ZONE :tz)) AS nowmin`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { tz, horizonte: MAX_DIAS_PLANIFICACION } }
            );
            const nowMin = Number(nowmin);
            let targetDate = hoy;
            if (req.query.date) {
                const d = String(req.query.date);
                if (!esFechaValida(d)) {
                    return res.status(400).json({ success: false, status: 400, message: 'Fecha inválida (formato esperado YYYY-MM-DD).' });
                }
                targetDate = d;
            }
            // Las tres fechas son 'YYYY-MM-DD', así que comparar como texto es correcto.
            // Pasado → histórico (solo lectura); hoy → operable; futuro → programable.
            const isToday = targetDate === hoy;
            const isFuture = targetDate > hoy;

            // ¿La fecha elegida es un día hábil de la ruta? Se resuelve aquí (no en el cliente)
            // para que el frontend no tenga que recalcular el día de la semana con la zona del
            // dispositivo, que puede no ser la de la compañía.
            const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
            const [{ isodow }] = await routes.sequelize.query(
                `SELECT EXTRACT(ISODOW FROM CAST(:dia AS date))::int AS isodow`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { dia: targetDate } }
            );
            const esDiaHabil = (route.working_days || []).includes(DIAS[Number(isodow) - 1]);

            // Nº de tiendas de la ruta (vía routes_stores).
            const tiendasEnRuta = await routes.sequelize.models.routes_stores.count({ where: { route_id: rid, company_id: companyId } });

            // 👥 Responsable de la jornada: quién tiene visitas de ESTA ruta ese día (por regla
            // de negocio hay uno solo; en datos antiguos podía haber dos, se devuelve el que más
            // paradas tenga). Si aún no se ha iniciado, el responsable previsto es el vendedor
            // asignado a la ruta. Se traen `first_name`/`last_name` POR SEPARADO a propósito: el
            // nombre corto que muestra la UI ("Carlos Morán") no se puede derivar del
            // `user_name` concatenado, porque no se sabe dónde termina el nombre.
            const responsables = await routes.sequelize.query(
                `SELECT sv.user_id, u.first_name, u.last_name, count(*)::int AS paradas
                   FROM store_visits sv
                   JOIN users u ON u.id = sv.user_id
                  WHERE sv.route_id = :rid AND sv.visit_day = :dia
                  GROUP BY 1, 2, 3
                  ORDER BY paradas DESC`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { rid, dia: targetDate } }
            );

            // 👤 Quién sale como responsable:
            //   - Día OPERABLE (hoy o futuro) → el **encargado ACTUAL** de la ruta (`routes.user_id`),
            //     porque es quien debe terminarla, aunque parte de las paradas las haya resuelto el
            //     anterior tras un relevo.
            //   - Día PASADO → quien realmente la hizo (el de más paradas). El histórico no se reescribe
            //     porque hoy la ruta esté asignada a otra persona.
            const esPasado = targetDate < hoy;
            let responsable = null;
            if (esPasado) {
                responsable = responsables[0] || null;
            } else if (route.user_id) {
                const [asignado] = await routes.sequelize.query(
                    `SELECT id AS user_id, first_name, last_name,
                            (SELECT count(*)::int FROM store_visits sv
                              WHERE sv.route_id = :rid AND sv.visit_day = CAST(:dia AS date)) AS paradas
                       FROM users WHERE id = :uid`,
                    { type: routes.sequelize.QueryTypes.SELECT, replacements: { uid: route.user_id, rid, dia: targetDate } }
                );
                responsable = asignado || null;
            }

            // 🔐 Dos preguntas DISTINTAS que antes compartían una sola bandera:
            //
            //   ¿Puedo OPERAR esta lista? → ser el encargado ACTUAL de la ruta. Una ruta **sin
            //     encargado no la opera nadie**, ni el owner: no se puede iniciar (400), ni marcar,
            //     vender, reportar no-venta, optimizar o agregar una venta ocasional (403 en los
            //     cuatro). Antes `esMiLista` valía `true` para TODOS cuando `route.user_id` era
            //     null —por la rama `!route.user_id`— así que el cajón salía operable y ofrecía un
            //     menú de acciones que el servidor iba a rechazar. Ofrecer lo que se va a negar es
            //     peor que no ofrecerlo.
            //
            //   ¿Puedo VERLA? → la propia siempre; la de otro exige supervisar todas las rutas; y
            //     una ruta sin encargado no es de nadie y no tiene nada que esconder, así que se
            //     deja consultar (es además donde se explica que hay que asignarle un vendedor).
            const targetUserId = route.user_id || null;
            const esMiLista = Boolean(route.user_id) && route.user_id === req.user.id;
            if (!esMiLista && route.user_id) {
                const puedeVerDeOtros = req.user?.userType === 'owner'
                    || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('view_routes_by_company'));
                if (!puedeVerDeOtros) {
                    return res.status(403).json({ success: false, status: 403, message: 'No tiene permiso para ver la ruta de otro vendedor.' });
                }
            }

            // Visitas de la fecha (paradas) del responsable de la jornada.
            // Se une la tienda para traer sus horarios y clasificar cada parada PENDIENTE por
            // horario (abierta/abre_mas_tarde/cerrada) según la hora actual. Esto NO depende del
            // GPS (solo el ORDEN óptimo lo hace, y ese ya está en optimized_seq), así los chips
            // de horario aparecen SIEMPRE que sea hoy: al abrir y al reabrir el drawer.
            // ⚠️ SIN filtro por `user_id`: la jornada es de la ruta. Tras un relevo sus paradas
            // quedan repartidas entre el vendedor anterior y el nuevo, y filtrar por usuario
            // escondería la mitad de la lista al que la está recorriendo.
            const visitas = await store_visits.findAll({
                where: { route_id: rid, visit_day: targetDate },
                attributes: ['id', 'store_id', 'store_name', 'store_address', 'status', 'arrived_at', 'sale_amount', 'optimized_seq', 'visit_type'],
                // 📍 Las coordenadas viajan con cada parada para que el cajón sea AUTOSUFICIENTE:
                // el menú de la fila (cómo llegar, ver en el mapa, marcar con la regla de los
                // 300 m) necesitaba la tienda completa y la sacaba de la MEMBRESÍA de la ruta.
                // Una parada ocasional no está en esa lista —ni una tienda retirada de la ruta
                // con la jornada abierta—, así que el menú no se abría.
                include: [{
                    association: 'store',
                    attributes: [
                        'opening_time', 'closing_time',
                        [routes.sequelize.fn('ST_Y', routes.sequelize.col('store.ubicacion')), 'latitude'],
                        [routes.sequelize.fn('ST_X', routes.sequelize.col('store.ubicacion')), 'longitude'],
                    ],
                    required: false,
                }],
                order: [
                    // Pendientes primero; dentro de ellas, por el orden optimizado (NULLS LAST =
                    // las aún no optimizadas al final, alfabéticas). Visitadas/completadas por nombre.
                    [routes.sequelize.literal(`CASE store_visits.status WHEN 'pending' THEN 0 WHEN 'visited' THEN 1 ELSE 2 END`), 'ASC'],
                    routes.sequelize.literal('store_visits.optimized_seq ASC NULLS LAST'),
                    ['store_name', 'ASC'],
                ],
                raw: true,
            });

            const resumen = { pending: 0, visited: 0, completed: 0, total: visitas.length };
            for (const v of visitas) { if (resumen[v.status] !== undefined) resumen[v.status] += 1; }

            const lista = visitas.map((v) => {
                // Estado por horario solo para pendientes de HOY (es time-dependent).
                let estado = null;
                let abre_a = null;
                if (isToday && v.status === 'pending') {
                    const c = classify(parseWindows(v['store.opening_time'], v['store.closing_time']), nowMin);
                    estado = c.estado;
                    if (c.estado === 'abre_mas_tarde') abre_a = formatMinutes(c.abreA);
                }
                return {
                    visit_id: v.id,
                    store_id: v.store_id,
                    store_name: v.store_name,
                    store_address: v.store_address,
                    status: v.status,
                    arrived_at: v.arrived_at,
                    sale_amount: Number(v.sale_amount) || 0,
                    optimized_seq: v.optimized_seq,
                    // 'occasional' = la agregó el vendedor sobre la marcha; su tienda no
                    // pertenece a la ruta. El cajón puede distinguirla visualmente.
                    visit_type: v.visit_type,
                    latitude: v['store.latitude'] !== undefined && v['store.latitude'] !== null ? Number(v['store.latitude']) : null,
                    longitude: v['store.longitude'] !== undefined && v['store.longitude'] !== null ? Number(v['store.longitude']) : null,
                    estado,
                    abre_a,
                    // 🕗 Los horarios EN CRUDO, además del veredicto ya calculado.
                    //
                    // `estado` y `abre_a` se resuelven arriba comparando contra la hora de ESTA
                    // petición, así que son un dato con fecha de caducidad. En cuanto la jornada se
                    // guarde en el navegador para trabajar sin conexión, ese veredicto quedaría
                    // **congelado a la hora de iniciar la ruta**: una tienda que abre a las 9
                    // seguiría diciendo "abre más tarde" a las 4 de la tarde. Y como la lista se
                    // ORDENA por ese campo (ver `rangoHorario` justo abajo, y `horarioRank` en el
                    // cliente), el orden entero se quedaría clavado al amanecer.
                    //
                    // Con las ventanas crudas el cliente recalcula el estado con la hora actual,
                    // portando `parseWindows`/`classify` de `utils/routeOptimization` (funciones
                    // puras, sin BD). Es la misma decisión que ya tomamos con el día hábil en
                    // `client/src/utils/diaHabil.ts`: el servidor manda el dato, el cliente saca la
                    // conclusión. Ya venían en el SELECT, así que no cuesta ni una consulta más.
                    opening_time: v['store.opening_time'] ?? null,
                    closing_time: v['store.closing_time'] ?? null,
                };
            });

            // 🔢 Orden final de la lista: pendientes ABIERTAS → pendientes que abren más tarde
            // → pendientes CERRADAS → visitadas → completadas. El `sort` de JS es estable, así
            // que dentro de cada grupo se conserva el orden que ya trajo el SQL (optimized_seq
            // y luego nombre). En fechas que no son hoy `estado` es null y todas las pendientes
            // quedan en el mismo grupo, conservando su orden.
            const rangoHorario = { abierta: 0, abre_mas_tarde: 1, cerrada: 2 };
            const rango = (v) => {
                if (v.status === 'pending') return rangoHorario[v.estado] ?? 0;
                return v.status === 'visited' ? 10 : 20;
            };
            lista.sort((a, b) => rango(a) - rango(b));

            return res.status(200).json({
                success: true,
                status: 200,
                route_id: rid,
                route_name: route.name,
                visit_day: targetDate,
                today: hoy,
                is_today: isToday,
                is_future: isFuture,
                // ¿La fecha elegida es día hábil de la ruta? Solo el owner puede iniciar fuera
                // de los días hábiles; el frontend lo usa para avisar antes de pulsar.
                es_dia_habil: esDiaHabil,
                // Fecha máxima que el calendario puede ofrecer (hoy + horizonte de planificación).
                max_planificacion: tope,
                tiendas_en_ruta: tiendasEnRuta,
                started: visitas.length > 0,
                // De quién es la jornada y si es la del propio usuario (la única sobre la que
                // puede actuar: marcar, optimizar, vender). `null` = la ruta no tiene encargado,
                // y entonces no es de nadie: no se puede iniciar ni operar.
                user_id: targetUserId,
                es_mi_lista: esMiLista,
                // Responsable: quien la lleva ese día si ya está iniciada; si no, el vendedor
                // asignado a la ruta (a cuyo nombre se creará). null = ruta sin vendedor.
                responsable: responsable
                    ? {
                        user_id: responsable.user_id,
                        first_name: responsable.first_name,
                        last_name: responsable.last_name,
                        paradas: Number(responsable.paradas) || 0,
                    }
                    : null,
                resumen,
                visitas: lista,
            });
        } catch (error) {
            console.error("❌ Error al obtener las visitas del día:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al obtener las visitas.' });
        }
    },

    /**
     * 🧭 GET /api/routes/:route_id/optimize?lat=&lng=
     * Recorrido óptimo del día para el vendedor. Sobre las visitas PENDIENTES de hoy:
     * clasifica cada tienda por horario (abierta / abre más tarde / cerrada) y ordena
     * las ABIERTAS desde el GPS del dispositivo (vecino más cercano + 2-opt, línea recta).
     * NO modifica datos: es una capa de orden/estado sobre las pendientes.
     */
    async optimizeRoute(req, res) {
        try {
            const { route_id } = req.params;
            const { lat, lng } = req.query;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }
            const latN = parseFloat(lat);
            const lngN = parseFloat(lng);
            if (isNaN(latN) || isNaN(lngN)) {
                return res.status(400).json({ success: false, status: 400, message: 'Se requiere tu ubicación (lat, lng).' });
            }

            const route = await routes.findOne({ where: { id: rid, company_id: companyId }, attributes: ['id', 'name', 'user_id'] });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // 🔐 Optimizar NO es solo leer: persiste `optimized_seq` en las paradas del día, y
            // además cuesta (GPS del dispositivo + cálculo del recorrido). Recalcularlo alguien que
            // no lo va a caminar es gasto sin destinatario. Misma regla que marcar, vender,
            // reportar no-venta y agregar una venta ocasional: el ENCARGADO ACTUAL.
            const permisoRuta = await autorizarSobreLaRuta({
                route, userId: req.user.id, accion: 'optimizar el recorrido',
            });
            if (!permisoRuta.autorizado) {
                return res.status(403).json({ success: false, status: 403, message: permisoRuta.mensaje });
            }

            // Día hábil + minutos del momento actual (zona horaria de la compañía, Capa B).
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const [{ hoy, nowmin }] = await routes.sequelize.query(
                `SELECT (now() AT TIME ZONE :tz)::date AS hoy,
                        EXTRACT(HOUR FROM (now() AT TIME ZONE :tz)) * 60
                        + EXTRACT(MINUTE FROM (now() AT TIME ZONE :tz)) AS nowmin`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { tz } }
            );
            const nowMin = Number(nowmin);

            // Visitas PENDIENTES del día DEL USUARIO que optimiza + coords/horarios.
            // Acotado por user_id: cada quien optimiza solo su propia lista.
            const pend = await routes.sequelize.query(
                `SELECT sv.id AS visit_id, sv.store_id, sv.store_name, sv.store_address,
                        ST_Y(s.ubicacion) AS lat, ST_X(s.ubicacion) AS lng,
                        s.opening_time, s.closing_time
                 FROM store_visits sv
                 JOIN stores s ON s.id = sv.store_id
                 WHERE sv.route_id = :rid AND sv.visit_day = :hoy AND sv.status = 'pending'`,
                { replacements: { rid, hoy }, type: routes.sequelize.QueryTypes.SELECT }
            );

            // Clasificar por horario.
            const abiertas = [];
            const abren_mas_tarde = [];
            const cerradas = [];
            for (const p of pend) {
                const base = {
                    visit_id: p.visit_id,
                    store_id: p.store_id,
                    store_name: p.store_name,
                    store_address: p.store_address,
                    lat: p.lat != null ? Number(p.lat) : null,
                    lng: p.lng != null ? Number(p.lng) : null,
                };
                const { estado, abreA } = classify(parseWindows(p.opening_time, p.closing_time), nowMin);
                if (estado === 'abierta') abiertas.push(base);
                else if (estado === 'abre_mas_tarde') abren_mas_tarde.push({ ...base, abre_a: formatMinutes(abreA) });
                else cerradas.push(base);
            }

            // Optimizar solo las abiertas desde el GPS.
            const origin = { lat: latN, lng: lngN };
            const { recorrido, distancia_total_m } = optimizeOpenStores(origin, abiertas);
            const recorridoConEstado = recorrido.map((r) => ({ ...r, estado: 'abierta' }));

            abren_mas_tarde.sort((a, b) => (a.abre_a || '').localeCompare(b.abre_a || ''));

            // 💾 Persistir el orden en `optimized_seq`: numeración CONTINUA de las pendientes
            // (abiertas optimizadas → abren más tarde → cerradas). Las no-pendientes se dejan en
            // NULL. Así, al reabrir el drawer, las pendientes cargan en este mismo orden.
            const orderedVisitIds = [
                ...recorridoConEstado.map((r) => r.visit_id),
                ...abren_mas_tarde.map((s) => s.visit_id),
                ...cerradas.map((s) => s.visit_id),
            ];
            const tx = await routes.sequelize.transaction();
            try {
                // Limpiar orden de las que ya no son pendientes (visitadas/completadas).
                await store_visits.update(
                    { optimized_seq: null },
                    { where: { route_id: rid, visit_day: hoy, status: { [Op.ne]: 'pending' } }, transaction: tx }
                );
                // Numerar las pendientes en el orden calculado.
                let seq = 1;
                for (const vid of orderedVisitIds) {
                    await store_visits.update({ optimized_seq: seq }, { where: { id: vid }, transaction: tx });
                    seq += 1;
                }
                await tx.commit();
            } catch (e) {
                await tx.rollback();
                throw e;
            }

            return res.status(200).json({
                success: true,
                status: 200,
                route_id: rid,
                route_name: route.name,
                visit_day: hoy,
                origin,
                recorrido: recorridoConEstado,
                abren_mas_tarde,
                cerradas,
                distancia_total_m,
                resumen: {
                    abiertas: recorridoConEstado.length,
                    abren_mas_tarde: abren_mas_tarde.length,
                    cerradas: cerradas.length,
                    total: pend.length,
                },
            });
        } catch (error) {
            console.error("❌ Error al optimizar la ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al optimizar la ruta.' });
        }
    },

    /**
     * 🔎 GET /api/routes/:route_id/adjustments
     * DIAGNÓSTICO de la desincronización entre la ruta y sus jornadas ABIERTAS (hoy .. hoy+30).
     * No modifica nada.
     *
     * 🧠 El porqué: la jornada (`store_visits`) es una FOTO que se toma al iniciar la ruta,
     * mientras que la membresía (`routes_stores`) sigue VIVA. Si después de iniciar se agrega
     * o se quita una tienda, la foto y la realidad divergen y nada las reconcilia: la tienda
     * nueva no se puede marcar ("no tiene visitas pendientes para hoy") y la tienda retirada
     * sigue apareciendo como parada del día.
     *
     * ⚠️ La comparación es de CONJUNTOS, no de cantidades. Si el mismo día se sacó una tienda
     * y se agregó otra, los totales cuadran (46 vínculos, 46 paradas) pero hay una parada
     * huérfana y una tienda sin parada. Contar diría "todo en orden" y el error seguiría vivo.
     */
    async getRouteAdjustments(req, res) {
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            const route = await routes.findOne({
                where: { id: rid, company_id: companyId },
                attributes: ['id', 'name'],
            });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            const tz = req.user?.companyTimezone || 'America/Bogota';
            const jornadas = await construirDiagnosticoDeAjuste({ rid, companyId, tz });

            // Solo se informan las jornadas sobre las que este usuario podría actuar.
            const visibles = jornadas.filter((j) => puedeAjustarJornada(req, j.responsable.user_id));

            const total_faltantes = visibles.reduce((n, j) => n + j.faltantes.length, 0);
            const total_sobrantes = visibles.reduce((n, j) => n + j.sobrantes.length, 0);
            const total_bloqueadas = visibles.reduce((n, j) => n + j.bloqueadas.length, 0);

            return res.status(200).json({
                success: true,
                status: 200,
                route_id: rid,
                route_name: route.name,
                hay_jornadas: visibles.length > 0,
                requiere_ajuste: (total_faltantes + total_sobrantes) > 0,
                jornadas: visibles.map(({ fecha_marca, ...j }) => j), // `fecha_marca` es interno
                total_faltantes,
                total_sobrantes,
                total_bloqueadas,
            });
        } catch (error) {
            console.error("❌ Error al diagnosticar los ajustes de la ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al revisar los ajustes de la ruta.' });
        }
    },

    /**
     * 🛠️ POST /api/routes/:route_id/adjustments
     * APLICA el ajuste que el usuario aprobó explícitamente en el diálogo.
     * Body: { agregar: [{ visit_day, store_id }], quitar: [visit_id, ...] }
     *
     * 🧠 Nada se sincroniza solo: el usuario decide ítem por ítem. Por eso "iniciar ruta"
     * sigue siendo idempotente y NO toca las jornadas ya abiertas — si sincronizara sola,
     * pisaría estas decisiones (un "no agregar" volvería a aparecer, una parada quitada
     * resucitaría).
     *
     * Cada ítem se REVALIDA contra la base dentro de la transacción: el diálogo pudo abrirse
     * hace minutos y la realidad pudo cambiar (la tienda volvió a la ruta, la parada ya se
     * marcó). Lo que ya no aplica se devuelve en `omitidas` con su motivo, sin abortar el resto.
     */
    async applyRouteAdjustments(req, res) {
        const transaction = await routes.sequelize.transaction();
        try {
            const { route_id } = req.params;
            const companyId = req.user?.companyId;
            const rid = parseInt(route_id);

            if (isNaN(rid)) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'ID de ruta inválido.' });
            }

            const route = await routes.findOne({
                where: { id: rid, company_id: companyId },
                attributes: ['id', 'name'],
                transaction,
            });
            if (!route) {
                await transaction.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            const agregar = Array.isArray(req.body?.agregar) ? req.body.agregar : [];
            const quitar = Array.isArray(req.body?.quitar) ? req.body.quitar : [];

            if (agregar.length === 0 && quitar.length === 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'No se indicó ningún ajuste por aplicar.' });
            }

            const tz = req.user?.companyTimezone || 'America/Bogota';
            const jornadas = await construirDiagnosticoDeAjuste({ rid, companyId, tz, transaction });
            const porDia = new Map(jornadas.map((j) => [j.visit_day, j]));

            const agregadas = [];
            const quitadas = [];
            const omitidas = [];

            // ── Agregar paradas faltantes ──────────────────────────────────────────────
            for (const item of agregar) {
                const dia = String(item?.visit_day || '');
                const sid = parseInt(item?.store_id);
                const jornada = porDia.get(dia);

                if (!jornada || isNaN(sid)) {
                    omitidas.push({ tipo: 'agregar', visit_day: dia, store_id: isNaN(sid) ? null : sid, motivo: 'Esa jornada ya no está abierta.' });
                    continue;
                }
                if (!puedeAjustarJornada(req, jornada.responsable.user_id)) {
                    omitidas.push({ tipo: 'agregar', visit_day: dia, store_id: sid, motivo: 'No puedes modificar la jornada de otro vendedor.' });
                    continue;
                }
                const faltante = jornada.faltantes.find((f) => f.store_id === sid);
                if (!faltante) {
                    omitidas.push({ tipo: 'agregar', visit_day: dia, store_id: sid, motivo: 'Esa tienda ya tiene parada ese día o ya no pertenece a la ruta.' });
                    continue;
                }

                const fila = construirParada({
                    store: { id: faltante.store_id, name: faltante.store_name, address: faltante.store_address },
                    route,
                    userId: jornada.responsable.user_id,
                    userName: jornada.responsable.user_name,
                    visitDay: dia,
                    fechaMarca: jornada.fecha_marca,
                });
                // ignoreDuplicates → ON CONFLICT DO NOTHING contra `uq_store_visits_daily`:
                // aplicar dos veces el mismo ajuste no duplica ni reinicia nada.
                await store_visits.bulkCreate([fila], { ignoreDuplicates: true, transaction });
                agregadas.push({ visit_day: dia, store_id: sid, store_name: faltante.store_name });
            }

            // ── Quitar paradas huérfanas (hard delete, solo 'pending') ─────────────────
            for (const raw of quitar) {
                const vid = parseInt(raw);
                if (isNaN(vid)) {
                    omitidas.push({ tipo: 'quitar', visit_id: null, motivo: 'Identificador de visita inválido.' });
                    continue;
                }

                const jornada = jornadas.find((j) => j.sobrantes.some((s) => s.visit_id === vid));
                const sobrante = jornada && jornada.sobrantes.find((s) => s.visit_id === vid);
                if (!jornada || !sobrante) {
                    omitidas.push({ tipo: 'quitar', visit_id: vid, motivo: 'Esa parada ya no se puede quitar (volvió a la ruta, ya se marcó o ya no existe).' });
                    continue;
                }
                if (!puedeAjustarJornada(req, jornada.responsable.user_id)) {
                    omitidas.push({ tipo: 'quitar', visit_id: vid, motivo: 'No puedes modificar la jornada de otro vendedor.' });
                    continue;
                }

                // 🛡️ Última barrera antes del hard delete. El diagnóstico ya excluye todo lo que
                // no esté en 'pending', pero se comprueba de nuevo contra las tablas hijas porque
                // `sales.visit_id` está en ON DELETE SET NULL: borrar una parada con venta NO
                // fallaría, simplemente desengancharía la venta en silencio. Daño invisible.
                const [{ ligada }] = await routes.sequelize.query(
                    `SELECT (EXISTS (SELECT 1 FROM sales WHERE visit_id = :vid)
                          OR EXISTS (SELECT 1 FROM store_no_sale_reports WHERE visit_id = :vid)) AS ligada`,
                    { type: routes.sequelize.QueryTypes.SELECT, replacements: { vid }, transaction }
                );
                if (ligada) {
                    omitidas.push({ tipo: 'quitar', visit_id: vid, motivo: 'La parada tiene una venta o un reporte de no-venta asociado.' });
                    continue;
                }

                const borradas = await store_visits.destroy({
                    where: { id: vid, route_id: rid, status: 'pending' },
                    transaction,
                });
                if (borradas > 0) {
                    quitadas.push({ visit_day: jornada.visit_day, visit_id: vid, store_name: sobrante.store_name });
                } else {
                    omitidas.push({ tipo: 'quitar', visit_id: vid, motivo: 'La parada cambió de estado mientras se aplicaba el ajuste.' });
                }
            }

            await transaction.commit();

            const partes = [];
            if (agregadas.length) partes.push(`${agregadas.length} visita${agregadas.length === 1 ? '' : 's'} agregada${agregadas.length === 1 ? '' : 's'}`);
            if (quitadas.length) partes.push(`${quitadas.length} visita${quitadas.length === 1 ? '' : 's'} quitada${quitadas.length === 1 ? '' : 's'}`);

            return res.status(200).json({
                success: true,
                status: 200,
                message: partes.length ? `Ajuste aplicado: ${partes.join(' y ')}.` : 'No se aplicó ningún cambio.',
                route_id: rid,
                agregadas,
                quitadas,
                omitidas,
            });
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback();
            console.error("❌ Error al aplicar el ajuste de la ruta:", error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al aplicar el ajuste.' });
        }
    },

    /**
     * 🆕 POST /api/routes/:route_id/occasional-visit   body: { store_id }
     *
     * **Venta ocasional:** el vendedor va en la ruta Norte, lo llama un tendero de la ruta Sur
     * y le agrega esa tienda a su jornada de HOY. Crea UNA parada `pending` más, y a partir de
     * ahí el flujo es el de siempre: aparece en el cajón del día, entra en la optimización del
     * recorrido, se marca visitada y se le vende.
     *
     * 🔑 **La parada lleva el `route_id` de la ruta que se está corriendo, a propósito.** Es una
     * parada más del día, como si se la hubieran asignado desde el principio: si el vendedor se
     * compromete y no la hace, es un incumplimiento real y debe contar como pendiente. Colgarla
     * de la ruta también le da tres cosas gratis que una parada "suelta" (sin ruta) no tendría:
     *   1. el índice único `(store_id, route_id, visit_day)` la protege contra duplicados —con
     *      `route_id NULL` Postgres considera los nulos distintos entre sí y nada impediría
     *      crear la misma parada cinco veces;
     *   2. la autorización cuelga del **encargado actual de la ruta**, así que sobrevive a un
     *      relevo a media jornada;
     *   3. el cajón de visitas lista por (ruta, día), así que se ve sin tocar nada.
     *
     * ⚠️ **NO se vincula la tienda a la ruta** (`routes_stores`): esa tabla es la membresía
     * PERMANENTE y la tienda del sur quedaría en la ruta norte mañana y todos los días. Lo que
     * la distingue es `visit_type = 'occasional'`, que además impide que el diagnóstico de
     * "Ajustar" la lea como parada huérfana y ofrezca borrarla.
     *
     * 📅 Solo HOY. Programar a futuro es "planear la ruta", y para eso está iniciar/ajustar; una
     * venta ocasional es por definición algo que surge sobre la marcha.
     */
    async createOccasionalVisit(req, res) {
        let transaction = null;
        try {
            const companyId = req.user?.companyId;
            const tz = req.user?.companyTimezone || 'America/Bogota';
            const rid = parseInt(req.params.route_id);
            const sid = parseInt(req.body?.store_id);

            if (isNaN(rid) || isNaN(sid)) {
                return res.status(400).json({
                    success: false, status: 400,
                    message: isNaN(rid) ? 'ID de ruta inválido.' : 'Debes indicar la tienda a visitar.',
                });
            }

            const route = await routes.findOne({
                where: { id: rid, company_id: companyId },
                attributes: ['id', 'name', 'user_id'],
            });
            if (!route) {
                return res.status(404).json({ success: false, status: 404, message: 'La ruta no existe o no pertenece a su compañía.' });
            }

            // 🔐 Mismo candado que marcar, vender y optimizar: el ENCARGADO ACTUAL, sin excepción
            // para el owner ni para `start_route_for_others`.
            //
            // Antes esto usaba `puedeAjustarJornada`, que SÍ deja pasar al owner y al supervisor. Era
            // incoherente: podían crearle la parada a un vendedor pero no marcarla ni venderle, así que
            // nacía huérfana en la jornada de alguien que no la pidió. Y no tiene sentido de fondo: una
            // venta ocasional surge de estar FRENTE a la tienda. Quien quiera hacerla se asigna la ruta.
            //
            // ⚠️ Va ANTES de comprobar si hay jornada, y antes de abrir la transacción. Al revés, una
            // ruta SIN encargado contestaba "no tiene jornada iniciada hoy, inicia la ruta primero" —
            // un consejo imposible de seguir, porque tampoco se puede iniciar sin vendedor. Autorizar
            // primero y trabajar después da el motivo REAL y ahorra la transacción.
            const permisoRuta = await autorizarSobreLaRuta({
                route, userId: req.user.id, accion: 'agregarle paradas a su jornada',
            });
            if (!permisoRuta.autorizado) {
                return res.status(403).json({ success: false, status: 403, message: permisoRuta.mensaje });
            }

            const [{ hoy, ahora }] = await routes.sequelize.query(
                `SELECT to_char((now() AT TIME ZONE :tz)::date, 'YYYY-MM-DD') AS hoy, now() AS ahora`,
                { type: routes.sequelize.QueryTypes.SELECT, replacements: { tz } }
            );

            transaction = await routes.sequelize.transaction();

            // La jornada tiene que EXISTIR. Sin ruta iniciada no hay a qué agregarle una parada,
            // y crearla aquí sería iniciar la ruta por la puerta de atrás, saltándose el día
            // hábil y el "un responsable por día".
            const paradasHoy = await store_visits.findAll({
                where: { route_id: rid, visit_day: hoy },
                attributes: ['id', 'store_id', 'user_id'],
                transaction,
            });

            if (paradasHoy.length === 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false, status: 400,
                    message: 'Esta ruta no tiene jornada iniciada hoy. Inicia la ruta antes de agregar una venta ocasional.',
                });
            }

            // Superado el candado de arriba, el encargado de la ruta ES quien pide: la parada nace
            // a su nombre. (Una ruta sin `user_id` no llega hasta aquí —nadie puede recorrerla—,
            // por eso no hace falta deducir el responsable contando paradas.)
            const responsableId = route.user_id;

            const store = await stores.findOne({
                where: { id: sid, company_id: companyId },
                attributes: ['id', 'name', 'address', 'deleted_at'],
                transaction,
            });
            if (!store || store.deleted_at) {
                await transaction.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La tienda no existe o fue eliminada.' });
            }

            // 🔁 Idempotencia: si esa tienda ya tiene parada hoy en esta ruta, se devuelve la que
            // hay. Pulsar dos veces no duplica ni reinicia el progreso de una parada ya visitada.
            const existente = paradasHoy.find((p) => p.store_id === store.id);
            if (existente) {
                const yaEsta = await store_visits.findByPk(existente.id, { transaction });
                await transaction.commit();
                return res.status(200).json({
                    success: true, status: 200, ya_existia: true,
                    message: 'Esta tienda ya está en la jornada de hoy.',
                    visita: await formatearParadaDelDia(yaEsta, tz),
                });
            }

            // 🏷️ `occasional` SOLO si la tienda no pertenece a la ruta. Si es miembro y se quedó
            // sin parada, lo que se está haciendo es un ajuste y esa parada es legítima: no
            // necesita la protección frente a "Ajustar", y marcarla confundiría el dato.
            const esMiembro = await routes.sequelize.models.routes_stores.count({
                where: { route_id: rid, store_id: store.id, company_id: companyId },
                transaction,
            });

            const fila = construirParada({
                store,
                route,
                userId: responsableId,
                userName: await nombreDelResponsable(responsableId, transaction),
                visitDay: hoy,
                fechaMarca: ahora,
                visitType: esMiembro > 0 ? 'in-route' : 'occasional',
            });

            const creada = await store_visits.create(fila, { transaction });
            await transaction.commit();

            return res.status(201).json({
                success: true,
                status: 201,
                ya_existia: false,
                message: esMiembro > 0
                    ? `${store.name} se agregó a la jornada de hoy.`
                    : `${store.name} se agregó como venta ocasional.`,
                visita: await formatearParadaDelDia(creada, tz),
            });
        } catch (error) {
            if (transaction && !transaction.finished) await transaction.rollback();
            console.error('❌ Error al crear la parada ocasional:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error interno del servidor al agregar la parada.' });
        }
    },
};
