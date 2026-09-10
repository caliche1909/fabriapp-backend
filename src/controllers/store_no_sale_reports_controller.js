const { store_no_sale_reports, stores, store_visits, sales } = require('../models');
const { autorizarSobreLaVisita } = require('../utils/storeVisits');
const {
    CODIGOS, leerCamposDeSincronizacion, buscarOperacionPrevia, esChoqueDeIdempotencia,
} = require('../utils/sincronizacion');
const { ValidationError, ForeignKeyConstraintError } = require('sequelize');


const StoreNoSaleReportsController = {

    // 📌 MÉTODO PARA CREAR UN REPORTE DE NO-VENTA
    // Único endpoint de este dominio usado por el frontend (DialogNoSaleReport). La
    // consulta/detalle de reportes vive en el módulo de sales (getNoSaleReport +
    // getNoSaleReportDetail), scopeado por compañía y con checkPermission('view_reports').
    async createNoSaleReport(req, res) {
        const user_id = req.user.id;
        const company_id = req.user.companyId;

        // 🔁 CONTRATO DE SINCRONIZACIÓN — se resuelve ANTES de abrir la transacción.
        //
        // Aquí ya existía media protección: `idx_unique_visit_report` impide dos reportes para la
        // misma visita. Pero eso responde 409 sin distinguir "es mi propio reintento" de "otro lo
        // reportó", y la cola de reenvío necesita saber cuál de las dos cosas pasó.
        const sync = leerCamposDeSincronizacion(req.body);
        if (!sync.ok) {
            return res.status(400).json({
                success: false, status: 400, code: CODIGOS.DATOS_INVALIDOS, message: sync.message,
            });
        }

        if (sync.clientOperationId) {
            const previa = await buscarOperacionPrevia(store_no_sale_reports, sync.clientOperationId);
            if (previa) {
                if (previa.company_id !== company_id) {
                    return res.status(409).json({
                        success: false, status: 409, code: CODIGOS.DATOS_INVALIDOS,
                        message: 'Ese identificador de operación ya se usó en otra compañía.',
                    });
                }
                return res.status(200).json({
                    success: true, status: 200, code: CODIGOS.YA_REGISTRADO,
                    message: 'Este reporte de no compra ya estaba registrado.',
                    data: { id: previa.id, visit_id: previa.visit_id },
                });
            }
        }

        // 🔄 Iniciar transacción para garantizar consistencia
        const transaction = await store_no_sale_reports.sequelize.transaction();

        try {
            const {
                visit_id,
                store_id,
                route_id,
                category_id,
                reason_id,
                comments,
                client_name,
                client_phone
            } = req.body;

            // Validar campos requeridos
            if (!store_id || !user_id || !company_id || !category_id || !reason_id || !comments) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Error en los campos requeridos'
                });
            }

            // Verificar que la tienda exista y sea de la compañía del usuario (aislamiento
            // multi-tenant: no permitir crear un reporte referenciando una tienda ajena).
            const store = await stores.findOne({ where: { id: store_id, company_id }, transaction });
            if (!store) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La tienda del reporte no existe'
                });
            }

            // Verificar que exista la visita del día para esta tienda y que esté
            // 'visited' (el estado de visita vive en store_visits, no en la tienda).
            const dayVisit = visit_id ? await store_visits.findByPk(visit_id, { transaction }) : null;
            if (!dayVisit || dayVisit.store_id !== parseInt(store_id) || dayVisit.status === 'pending') {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Esta tienda no tiene una visita registrada'
                });
            }

            // 🔐 Solo el ENCARGADO ACTUAL de la ruta puede cerrar sus visitas.
            // Antes NO se verificaba NINGUNA pertenencia: bastaba el permiso y que la visita no
            // estuviera 'pending', así que cualquiera podía reportar una no-venta sobre la visita
            // de otro vendedor —y eso CIERRA la parada en 'completed'—. Misma regla que marcar y vender.
            const permiso = await autorizarSobreLaVisita({
                visita: dayVisit, companyId: company_id, userId: user_id, transaction,
            });
            if (!permiso.autorizado) {
                await transaction.rollback();
                return res.status(403).json({ success: false, status: 403, code: CODIGOS.NO_ES_ENCARGADO, message: permiso.mensaje });
            }

            // Verificar que no exista un reporte para la misma visita (si se proporciona visit_id)
            if (visit_id) {
                const existingReport = await store_no_sale_reports.findOne({
                    where: { visit_id },
                    transaction
                });

                if (existingReport) {
                    await transaction.rollback();
                    // Para la cola de reenvío esto es un ÉXITO: la visita ya quedó cerrada como
                    // no-venta, que era el objetivo. Se separa de `YA_REGISTRADO` porque allí el
                    // reporte es literalmente el nuestro; aquí lo hizo otra operación.
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        code: CODIGOS.NO_VENTA_YA_REGISTRADA,
                        message: 'Ya existe un reporte de NO VENTA para esta visita'
                    });
                }
            }

            //verifiacar que no exista una venta para la misma visita (si se proporciona visit_id)
            if (visit_id) {
                const existingSale = await sales.findOne({
                    where: { visit_id },
                    transaction
                });

                if (existingSale) {
                    await transaction.rollback();
                    // Este SÍ es un rechazo real: la parada se cerró con VENTA, no con no-venta.
                    // La cola no debe reintentarlo; hay que contárselo al vendedor.
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        code: CODIGOS.VENTA_YA_REGISTRADA,
                        message: 'Ya se registró una venta para esta visita.'
                    });
                }
            }



            // Crear el reporte usando transacción para consistencia
            await store_no_sale_reports.create({
                visit_id: visit_id || null,
                store_id,
                user_id,
                route_id: route_id || null,
                company_id,
                category_id,
                reason_id,
                comments: comments.trim(),
                client_name: client_name ? client_name.trim() : null,
                client_phone: client_phone ? client_phone.trim() : null,

                // 🔁 Sincronización. Aquí `created_at` ES la fecha de negocio: los reportes de
                // no-venta se filtran por `(r.created_at AT TIME ZONE :tz)::date`. Por eso se
                // sobrescribe con la hora que declara el cliente, y por eso `synced_at` es
                // imprescindible: es el único rastro que queda de que la fila entró en diferido.
                // (A diferencia de `sales`, este modelo SÍ declara `created_at` como atributo
                // explícito, así que Sequelize respeta el valor.)
                ...(sync.occurredAt ? { created_at: sync.occurredAt } : {}),
                client_operation_id: sync.clientOperationId,
                synced_at: sync.syncedAt,
            }, { transaction });

            // (D4) Tras el reporte de no-venta la visita se CONCLUYE como 'completed'
            // (sin venta: sale_amount permanece en 0). Así ambos desenlaces —venta o
            // no-venta— cierran la visita, diferenciándose solo por sale_amount (>0 vs 0).
            // El estado de visita vive en store_visits; no se toca la tienda.
            if (visit_id) {
                await store_visits.update(
                    { status: 'completed' },
                    { where: { id: visit_id }, transaction }
                );
            }

            // ✅ Confirmar la transacción
            await transaction.commit();

            res.status(201).json({
                success: true,
                status: 201,
                message: 'El reporte de NO VENTA se ha creado exitosamente'
            });

        } catch (error) {
            // 🔄 Revertir la transacción en caso de error
            await transaction.rollback();

            // 🔁 Carrera de idempotencia (dos envíos simultáneos con el mismo uuid). La relectura
            // va después del rollback: en Postgres una sentencia fallida aborta la transacción.
            if (esChoqueDeIdempotencia(error) && sync.clientOperationId) {
                const previa = await buscarOperacionPrevia(store_no_sale_reports, sync.clientOperationId);
                if (previa) {
                    return res.status(200).json({
                        success: true, status: 200, code: CODIGOS.YA_REGISTRADO,
                        message: 'Este reporte de no compra ya estaba registrado.',
                        data: { id: previa.id, visit_id: previa.visit_id },
                    });
                }
            }

            console.error('Error al crear reporte de no-venta:', error);

            if (error instanceof ValidationError) {
                // 🎯 CASO ESPECÍFICO: Reporte duplicado para la misma visita
                const duplicateVisitError = error.errors.find(err =>
                    err.path === 'visit_id' &&
                    err.message.includes('Ya existe un reporte de no-venta para esta visita')
                );

                if (duplicateVisitError) {
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        message: 'Ya se registró un reporte de no-venta para esta visita'
                    });
                }

                // 🔍 Otros errores de validación
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Error de validación en los datos enviados',
                    errors: error.errors.map(err => ({
                        field: err.path,
                        message: err.message
                    }))
                });
            }

            if (error instanceof ForeignKeyConstraintError) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Error de integridad: Una o más referencias no existen'
                });
            }

            // 🔄 Fallback para otros casos del mensaje
            if (error.message.includes('Ya existe un reporte')) {
                return res.status(409).json({
                    success: false,
                    status: 409,
                    message: 'Ya se registró un reporte de no-venta para esta visita'
                });
            }

            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor al crear el reporte'
            });
        }
    }
};

module.exports = StoreNoSaleReportsController;
