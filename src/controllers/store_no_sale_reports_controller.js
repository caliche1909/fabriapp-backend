const { store_no_sale_reports, stores, store_visits, sales } = require('../models');
const { autorizarSobreLaVisita } = require('../utils/storeVisits');
const { ValidationError, ForeignKeyConstraintError } = require('sequelize');


const StoreNoSaleReportsController = {

    // 📌 MÉTODO PARA CREAR UN REPORTE DE NO-VENTA
    // Único endpoint de este dominio usado por el frontend (DialogNoSaleReport). La
    // consulta/detalle de reportes vive en el módulo de sales (getNoSaleReport +
    // getNoSaleReportDetail), scopeado por compañía y con checkPermission('view_reports').
    async createNoSaleReport(req, res) {
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

            // 🎯 Obtener user_id y company_id del token JWT
            const user_id = req.user.id;
            const company_id = req.user.companyId;

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
                return res.status(403).json({ success: false, status: 403, message: permiso.mensaje });
            }

            // Verificar que no exista un reporte para la misma visita (si se proporciona visit_id)
            if (visit_id) {
                const existingReport = await store_no_sale_reports.findOne({
                    where: { visit_id },
                    transaction
                });

                if (existingReport) {
                    await transaction.rollback();
                    return res.status(409).json({
                        success: false,
                        status: 409,
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
                    return res.status(409).json({
                        success: false,
                        status: 409,
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
                client_phone: client_phone ? client_phone.trim() : null
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
