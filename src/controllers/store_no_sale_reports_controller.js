const { store_no_sale_reports, no_sale_categories, no_sale_reasons, stores, users, routes, companies, store_visits, sales } = require('../models');
const { ValidationError, ForeignKeyConstraintError } = require('sequelize');


const StoreNoSaleReportsController = {

    // 📌 MÉTODO PARA CREAR UN REPORTE DE NO-VENTA
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

            // Verificar que la tienda exista
            const store = await stores.findByPk(store_id, { transaction });
            if (!store) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'La tienda del reporte no existe'
                });
            }

            // verificar que la tienda este visitada antes de generer el reporte
            if (visit_id !== store.current_visit_id || store.current_visit_status === 'pending') {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Esta tienda no tiene una visita registrada'
                });
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

            // 🏪 Marcar la tienda como 'completed' después de crear el reporte de no-venta
            await stores.update(
                { current_visit_status: 'completed' },
                {
                    where: { id: store_id },
                    transaction
                }
            );

            // ✅ Confirmar la transacción
            await transaction.commit();

            res.status(201).json({
                success: true,
                status: 201,
                message: 'El reporte de NO VENTA se ha creado exitosamente y la tienda ha sido marcada como completada'
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
    },

    // 📌 MÉTODO PARA OBTENER REPORTES POR COMPAÑÍA
    async getReportsByCompany(req, res) {
        try {
            const { companyId } = req.params;
            const { page = 1, limit = 10, startDate, endDate, categoryId, reasonId, userId, storeId } = req.query;

            const offset = (page - 1) * limit;
            const whereConditions = {};

            // Filtros opcionales
            if (startDate && endDate) {
                whereConditions.created_at = {
                    [require('sequelize').Op.between]: [new Date(startDate), new Date(endDate)]
                };
            }
            if (categoryId) whereConditions.category_id = categoryId;
            if (reasonId) whereConditions.reason_id = reasonId;
            if (userId) whereConditions.user_id = userId;
            if (storeId) whereConditions.store_id = storeId;

            const reports = await store_no_sale_reports.findByCompany(companyId, {
                where: whereConditions,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            const totalReports = await store_no_sale_reports.count({
                where: {
                    company_id: companyId,
                    ...whereConditions
                }
            });

            res.status(200).json({
                success: true,
                status: 200,
                data: {
                    reports,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: Math.ceil(totalReports / limit),
                        totalReports,
                        limit: parseInt(limit)
                    }
                }
            });

        } catch (error) {
            console.error('Error al obtener reportes por compañía:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 MÉTODO PARA OBTENER REPORTES POR USUARIO
    async getReportsByUser(req, res) {
        try {
            const { userId } = req.params;
            const { page = 1, limit = 10, startDate, endDate } = req.query;

            const offset = (page - 1) * limit;
            const whereConditions = {};

            if (startDate && endDate) {
                whereConditions.created_at = {
                    [require('sequelize').Op.between]: [new Date(startDate), new Date(endDate)]
                };
            }

            const reports = await store_no_sale_reports.findByUser(userId, {
                where: whereConditions,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            const totalReports = await store_no_sale_reports.count({
                where: {
                    user_id: userId,
                    ...whereConditions
                }
            });

            res.status(200).json({
                success: true,
                status: 200,
                data: {
                    reports,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: Math.ceil(totalReports / limit),
                        totalReports,
                        limit: parseInt(limit)
                    }
                }
            });

        } catch (error) {
            console.error('Error al obtener reportes por usuario:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 MÉTODO PARA OBTENER ESTADÍSTICAS POR CATEGORÍA
    async getStatsByCategory(req, res) {
        try {
            const { companyId } = req.params;
            const { startDate, endDate } = req.query;

            const stats = await store_no_sale_reports.getStatsByCategory(companyId, {
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null
            });

            res.status(200).json({
                success: true,
                status: 200,
                data: stats
            });

        } catch (error) {
            console.error('Error al obtener estadísticas:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 MÉTODO PARA OBTENER UN REPORTE ESPECÍFICO
    async getReportById(req, res) {
        try {
            const { reportId } = req.params;

            const report = await store_no_sale_reports.findByPk(reportId, {
                include: [
                    { model: stores, as: 'store' },
                    { model: users, as: 'user', attributes: ['id', 'name', 'email'] },
                    { model: no_sale_categories, as: 'category' },
                    { model: no_sale_reasons, as: 'reason' },
                    { model: routes, as: 'route', required: false },
                    { model: store_visits, as: 'visit', required: false },
                    { model: companies, as: 'company', attributes: ['id', 'name'] }
                ]
            });

            if (!report) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Reporte de no-venta no encontrado'
                });
            }

            res.status(200).json({
                success: true,
                status: 200,
                data: report
            });

        } catch (error) {
            console.error('Error al obtener reporte:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 MÉTODO PARA ACTUALIZAR UN REPORTE
    async updateReport(req, res) {
        try {
            const { reportId } = req.params;
            const {
                category_id,
                reason_id,
                comments,
                client_name,
                client_phone
            } = req.body;

            const report = await store_no_sale_reports.findByPk(reportId);

            if (!report) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Reporte de no-venta no encontrado'
                });
            }

            // Preparar datos de actualización
            const updateData = {};
            if (category_id) updateData.category_id = category_id;
            if (reason_id) updateData.reason_id = reason_id;
            if (comments) updateData.comments = comments.trim();
            if (client_name !== undefined) updateData.client_name = client_name ? client_name.trim() : null;
            if (client_phone !== undefined) updateData.client_phone = client_phone ? client_phone.trim() : null;

            // Actualizar el reporte
            await report.update(updateData);

            // Si se cambió la categoría o razón, validar compatibilidad
            if (category_id || reason_id) {
                await report.validateCategoryReason();
            }

            // Obtener el reporte actualizado con todas las relaciones
            const updatedReport = await store_no_sale_reports.findByPk(reportId, {
                include: [
                    { model: stores, as: 'store' },
                    { model: users, as: 'user', attributes: ['id', 'name', 'email'] },
                    { model: no_sale_categories, as: 'category' },
                    { model: no_sale_reasons, as: 'reason' },
                    { model: routes, as: 'route', required: false },
                    { model: store_visits, as: 'visit', required: false }
                ]
            });

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Reporte actualizado exitosamente',
                data: updatedReport
            });

        } catch (error) {
            console.error('Error al actualizar reporte:', error);

            if (error instanceof ValidationError) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Error de validación',
                    errors: error.errors.map(err => ({
                        field: err.path,
                        message: err.message
                    }))
                });
            }

            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 MÉTODO PARA ELIMINAR UN REPORTE
    async deleteReport(req, res) {
        try {
            const { reportId } = req.params;

            const report = await store_no_sale_reports.findByPk(reportId);

            if (!report) {
                return res.status(404).json({
                    success: false,
                    status: 404,
                    message: 'Reporte de no-venta no encontrado'
                });
            }

            await report.destroy();

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Reporte eliminado exitosamente'
            });

        } catch (error) {
            console.error('Error al eliminar reporte:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    }
};

module.exports = StoreNoSaleReportsController;