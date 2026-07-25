const { sales: Sales, stores: Stores, store_no_sale_reports, store_visits: StoreVisits } = require('../models');
const { Op } = require('sequelize');

/**
 * 🛒 CONTROLADOR DE VENTAS
 * Maneja todas las operaciones CRUD para ventas
 */

/**
 * 📝 Crear una nueva venta
 */
module.exports = {
    async createSale(req, res) {
        // 1. Iniciar una transacción
        const transaction = await Sales.sequelize.transaction();

        try {
            const {
                subtotal, tax_amount, discount_amount, total_amount,
                store_id, payment_method_id, route_id, visit_id
            } = req.body;

            const user_id = req.user.id;
            const company_id = req.user.companyId;

            // 2. Validación (Idealmente con Zod/Joi, pero aquí mejorada)
            if (!total_amount || !store_id || !payment_method_id) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Faltan datos obligatorios para crear una venta'
                });
            }

            // 3. Verificación de cálculo con enteros (centavos)
            const subtotalInCents = Math.round(parseFloat(subtotal || 0) * 100);
            const taxInCents = Math.round(parseFloat(tax_amount || 0) * 100);
            const discountInCents = Math.round(parseFloat(discount_amount || 0) * 100);
            const totalInCents = Math.round(parseFloat(total_amount) * 100);

            const calculatedTotalInCents = subtotalInCents + taxInCents - discountInCents;

            if (Math.abs(calculatedTotalInCents - totalInCents) > 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Error en los cálculos: El total no coincide con los valores desglosados.'
                });
            }

            // Verificar que no exista un reporte para la misma visita (si se proporciona visit_id)
            if (visit_id) {
                const existingNoSaleReport = await store_no_sale_reports.findOne({
                    where: { visit_id },
                    transaction
                });

                if (existingNoSaleReport) {
                    await transaction.rollback();
                    return res.status(409).json({
                        success: false,
                        status: 409,
                        message: 'Ya se enviió un reporte de no-venta para esta visita.'
                    });
                }
            }

            //verifiacar que no exista una venta para la misma visita (si se proporciona visit_id)
            if (visit_id) {
                const existingSale = await Sales.findOne({
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


            // 4. Crear la venta DENTRO de la transacción
            const newSale = await Sales.create({
                company_id,
                user_id,
                store_id,
                payment_method_id,
                subtotal,
                tax_amount,
                discount_amount,
                total_amount,
                route_id: route_id || null,
                visit_id: visit_id || null,
                status: 'completed'
            }, { transaction });

            // 5. 💰 Actualizar la visita: monto vendido + avanzar a 'completed'.
            // (El estado de visita vive en store_visits; ya no se toca la tienda.)
            if (visit_id) {
                await StoreVisits.update(
                    { sale_amount: total_amount, status: 'completed' },
                    {
                        where: { id: visit_id },
                        transaction
                    }
                );
            }

            // Aquí iría la lógica futura (ej. actualizar inventario), también con { transaction }

            // 7. Confirmar la transacción
            await transaction.commit();

            return res.status(201).json({
                success: true,
                message: 'Venta registrada exitosamente',
                data: newSale
            });

        } catch (error) {
            // Si algo falla, la transacción se revierte
            await transaction.rollback();
            console.error('Error al crear venta:', error);
            res.status(500).json({ message: 'Error interno del servidor' });
        }
    }
}


