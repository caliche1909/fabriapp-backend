const { inventory_locations, users, user_companies, product_stock_balances, stock_transfers, sequelize } = require('../models');
const { Op } = require('sequelize');

/**
 * 🏬 CONTROLADOR DE BODEGAS (inventory_locations)
 *
 * Multi-tenant: todo se filtra SIEMPRE por la compañía de la sesión (req.user.companyId),
 * nunca por datos del cliente. Paranoid: las eliminadas quedan fuera automáticamente.
 *
 * Alcance de la lista (quién ve qué):
 *   - OWNER                         → TODAS las bodegas de su compañía.
 *   - Colaborador con `view_warehouses` → TODAS las bodegas de su compañía.
 *   - Colaborador SIN ese permiso   → SOLO la(s) bodega(s) de las que es RESPONSABLE
 *                                     (inventory_locations.user_id = req.user.id).
 *
 * El permiso `view_warehouses` está sembrado desde la migración `20260803170000` (junto con
 * create/edit/delete y los de traspasos), asignado al rol ADMIN.
 */

// 🔧 Da forma a una bodega para el frontend (solo metadatos; el stock va aparte, B-D11).
const formatWarehouse = (w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    is_default: w.is_default,
    is_active: w.is_active,
    responsable: w.user
        ? { id: w.user.id, name: `${w.user.first_name || ''} ${w.user.last_name || ''}`.trim() }
        : null,
    address: w.address,
    description: w.description,
    created_at: w.created_at,
    updated_at: w.updated_at,
});

module.exports = {
    /**
     * 📋 GET /api/warehouses/list — Bodegas de la compañía según el alcance del usuario.
     * Devuelve la LISTA COMPLETA de su alcance (sin filtros de servidor): el frontend la cachea
     * (B-D11) y filtra/busca en cliente. Ordena la central primero, luego por nombre.
     */
    async getWarehouses(req, res) {
        try {
            const company_id = req.user.companyId;

            // ¿Puede ver todas las bodegas? Owner o colaborador con el permiso.
            const canViewAll = req.user.userType === 'owner'
                || (Array.isArray(req.user.permissions) && req.user.permissions.includes('view_warehouses'));

            const where = { company_id };
            if (!canViewAll) {
                // Sin permiso de "ver todas": solo las bodegas de las que es responsable.
                where.user_id = req.user.id;
            }

            const rows = await inventory_locations.findAll({
                where,
                include: [{
                    model: users,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name'],
                    required: false, // LEFT JOIN: una bodega sin responsable igual se devuelve
                }],
                order: [
                    ['is_default', 'DESC'],
                    ['name', 'ASC'],
                ],
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: rows.length ? 'Bodegas obtenidas exitosamente' : 'No hay bodegas para mostrar',
                warehouses: rows.map(formatWarehouse),
            });
        } catch (error) {
            console.error('❌ Error al obtener las bodegas:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al obtener las bodegas',
                warehouses: [],
            });
        }
    },

    /**
     * ➕ POST /api/warehouses/create — Crea una bodega (móvil o punto de venta).
     * Body: { name, type ('movil'|'punto_venta'), status?, user_id?, address?, description? }.
     *
     * Protecciones (la central es intocable): NUNCA se crea una `central` por aquí (solo el
     * registro de compañía la crea, is_default), ni se marca is_default. Todo tenant-scoped por
     * sesión. Nombre único por compañía (entre las vivas). Regla B-D10: un usuario responsable de
     * a lo sumo UNA bodega (de cualquier tipo).
     */
    async createWarehouse(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const { name, type, status, user_id, address, description } = req.body;

            // 🔹 Nombre obligatorio.
            const cleanName = (name || '').trim();
            if (!cleanName) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'El nombre de la bodega es obligatorio' });
            }
            if (cleanName.length > 100) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'El nombre no puede superar los 100 caracteres' });
            }

            // 🔹 Tipo: SOLO móvil o punto de venta. La central no se crea por aquí (protección).
            if (!['movil', 'punto_venta'].includes(type)) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Selecciona un tipo de bodega válido (móvil o punto de venta)' });
            }

            // 🔹 Estado operativo (default abierta).
            const finalStatus = status === 'cerrada' ? 'cerrada' : 'abierta';

            // 🔹 Responsable (opcional): debe pertenecer a la compañía; si es móvil, único por usuario.
            let responsableId = null;
            if (user_id) {
                const membership = await user_companies.findOne({
                    where: { user_id, company_id, status: 'active' },
                    transaction: t,
                });
                if (!membership) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'El responsable seleccionado no pertenece a la compañía' });
                }
                responsableId = user_id;

                // Regla B-D10: un usuario es responsable de A LO SUMO UNA bodega (de cualquier tipo).
                const alreadyResponsible = await inventory_locations.findOne({
                    where: { company_id, user_id: responsableId },
                    transaction: t,
                });
                if (alreadyResponsible) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Este usuario ya es responsable de otra bodega' });
                }
            }

            // 🔹 Nombre único por compañía (case-insensitive, entre las vivas).
            const dup = await inventory_locations.findOne({
                where: { company_id, name: { [Op.iLike]: cleanName } },
                transaction: t,
            });
            if (dup) {
                await t.rollback();
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe una bodega con ese nombre' });
            }

            // 🔹 Crear (nunca is_default; nunca central).
            const created = await inventory_locations.create({
                company_id,
                name: cleanName,
                type,
                status: finalStatus,
                is_default: false,
                is_active: true,
                user_id: responsableId,
                address: address ? String(address).trim() : null,
                description: description ? String(description).trim() : null,
            }, { transaction: t });

            // Releer con el responsable para devolver el formato completo.
            const withUser = await inventory_locations.findOne({
                where: { id: created.id },
                include: [{ model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false }],
                transaction: t,
            });

            await t.commit();

            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Bodega creada exitosamente',
                warehouse: formatWarehouse(withUser),
            });
        } catch (error) {
            await t.rollback();
            console.error('❌ Error al crear la bodega:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al crear la bodega' });
        }
    },

    /**
     * ✏️ PUT /api/warehouses/update/:id — Actualiza una bodega.
     *
     * LA CENTRAL ES INTOCABLE salvo su responsable:
     *   - `is_default` NUNCA se modifica (no se lee del cliente) → solo la central lo tiene en true.
     *   - Si la bodega es la central (is_default): SOLO se aplica el responsable; nombre, tipo y
     *     estado se IGNORAN (no se puede renombrar ni cerrar ni cambiar su tipo).
     *   - Si NO es central: se pueden editar nombre, tipo (movil/punto_venta), estado, responsable,
     *     dirección y descripción.
     * Regla B-D10 en edición: un usuario responsable de a lo sumo UNA bodega (excluyendo esta).
     * Tenant-scoped: 404 si la bodega no es de la compañía de la sesión.
     */
    async updateWarehouse(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;
            const { name, type, status, user_id, address, description } = req.body;

            const wh = await inventory_locations.findOne({ where: { id, company_id }, transaction: t });
            if (!wh) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega no existe o no pertenece a tu compañía' });
            }

            const isCentral = wh.is_default === true;

            // 🔹 Responsable (aplica a central y no-central): validar pertenencia + unicidad global.
            let responsableId = null;
            let responsableProvided = false;
            if (user_id !== undefined) {
                responsableProvided = true;
                if (user_id === null || user_id === '') {
                    responsableId = null; // desasignar
                } else {
                    const membership = await user_companies.findOne({
                        where: { user_id, company_id, status: 'active' },
                        transaction: t,
                    });
                    if (!membership) {
                        await t.rollback();
                        return res.status(400).json({ success: false, status: 400, message: 'El responsable seleccionado no pertenece a la compañía' });
                    }
                    const other = await inventory_locations.findOne({
                        where: { company_id, user_id, id: { [Op.ne]: wh.id } },
                        transaction: t,
                    });
                    if (other) {
                        await t.rollback();
                        return res.status(400).json({ success: false, status: 400, message: 'Este usuario ya es responsable de otra bodega' });
                    }
                    responsableId = user_id;
                }
            }

            if (isCentral) {
                // Central: SOLO responsable. Nombre/tipo/estado/is_default intocables.
                if (responsableProvided) {
                    await wh.update({ user_id: responsableId }, { transaction: t });
                }
            } else {
                // No central: validar y aplicar el resto.
                const cleanName = (name || '').trim();
                if (!cleanName) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'El nombre de la bodega es obligatorio' });
                }
                if (cleanName.length > 100) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'El nombre no puede superar los 100 caracteres' });
                }
                if (!['movil', 'punto_venta'].includes(type)) {
                    await t.rollback();
                    return res.status(400).json({ success: false, status: 400, message: 'Selecciona un tipo de bodega válido (móvil o punto de venta)' });
                }
                const finalStatus = status === 'cerrada' ? 'cerrada' : 'abierta';

                const dup = await inventory_locations.findOne({
                    where: { company_id, name: { [Op.iLike]: cleanName }, id: { [Op.ne]: wh.id } },
                    transaction: t,
                });
                if (dup) {
                    await t.rollback();
                    return res.status(409).json({ success: false, status: 409, message: 'Ya existe una bodega con ese nombre' });
                }

                await wh.update({
                    name: cleanName,
                    type,
                    status: finalStatus,
                    user_id: responsableProvided ? responsableId : wh.user_id,
                    address: address !== undefined ? (address ? String(address).trim() : null) : wh.address,
                    description: description !== undefined ? (description ? String(description).trim() : null) : wh.description,
                }, { transaction: t });
            }

            const withUser = await inventory_locations.findOne({
                where: { id: wh.id },
                include: [{ model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false }],
                transaction: t,
            });

            await t.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Bodega actualizada exitosamente',
                warehouse: formatWarehouse(withUser),
            });
        } catch (error) {
            await t.rollback();
            console.error('❌ Error al actualizar la bodega:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al actualizar la bodega' });
        }
    },

    /**
     * 🔁 PATCH /api/warehouses/:id/status — Abre o cierra una bodega (acción rápida).
     * Body: { status: 'abierta' | 'cerrada' }.
     *
     * Endpoint DEDICADO (parcial): solo cambia el estado, sin disparar las validaciones del edit
     * general (nombre único, regla del responsable). Protecciones:
     *   - LA CENTRAL NO SE CIERRA NI SE ABRE manualmente (siempre operativa).
     *   - `is_default` no se toca. Tenant-scoped: 404 si la bodega no es de la compañía.
     */
    async toggleWarehouseStatus(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;
            const { status } = req.body;

            // 🔹 Estado válido.
            if (!['abierta', 'cerrada'].includes(status)) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'Estado de bodega no válido' });
            }

            const wh = await inventory_locations.findOne({ where: { id, company_id }, transaction: t });
            if (!wh) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega no existe o no pertenece a tu compañía' });
            }

            // 🔹 La central es intocable: no se cierra ni se abre manualmente.
            if (wh.is_default === true) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega central no se puede cerrar' });
            }

            // Sin cambios reales: responde OK igual (idempotente) sin escribir.
            if (wh.status !== status) {
                await wh.update({ status }, { transaction: t });
            }

            const withUser = await inventory_locations.findOne({
                where: { id: wh.id },
                include: [{ model: users, as: 'user', attributes: ['id', 'first_name', 'last_name'], required: false }],
                transaction: t,
            });

            await t.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: status === 'cerrada' ? 'Bodega cerrada exitosamente' : 'Bodega abierta exitosamente',
                warehouse: formatWarehouse(withUser),
            });
        } catch (error) {
            await t.rollback();
            console.error('❌ Error al cambiar el estado de la bodega:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al cambiar el estado de la bodega' });
        }
    },

    /**
     * 🗑️ DELETE /api/warehouses/delete/:id — Eliminación LÓGICA (soft-delete paranoid) con
     * auditoría (`deleted_by` vía hook beforeDestroy → exige userId).
     *
     * Protecciones:
     *   - LA CENTRAL NO SE ELIMINA (is_default) → 400.
     *   - NO se elimina una bodega que aún TIENE STOCK (balance > 0): se perdería el inventario
     *     (el soft-delete no dispara el CASCADE de balances). Hay que vaciarla/trasladarla antes.
     *   - NO se elimina una bodega con TRASPASOS pendientes/en tránsito (origen o destino).
     * Tenant-scoped: 404 si la bodega no es de la compañía. Al eliminarla, su responsable queda
     * libre (la regla "un usuario = una bodega" solo cuenta bodegas vivas).
     */
    async deleteWarehouse(req, res) {
        const t = await sequelize.transaction();
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const wh = await inventory_locations.findOne({ where: { id, company_id }, transaction: t });
            if (!wh) {
                await t.rollback();
                return res.status(404).json({ success: false, status: 404, message: 'La bodega no existe o no pertenece a tu compañía' });
            }

            // 🔹 La central es intocable.
            if (wh.is_default === true) {
                await t.rollback();
                return res.status(400).json({ success: false, status: 400, message: 'La bodega central no se puede eliminar' });
            }

            // 🔹 No eliminar si aún tiene stock (evita perder inventario silenciosamente).
            const withStock = await product_stock_balances.findOne({
                where: { location_id: wh.id, balance: { [Op.gt]: 0 } },
                transaction: t,
            });
            if (withStock) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'No puedes eliminar una bodega que aún tiene stock. Traslada o descarga su inventario primero.',
                });
            }

            // 🔹 No eliminar si tiene traspasos abiertos (pendiente/en tránsito) como origen o destino.
            const openTransfer = await stock_transfers.findOne({
                where: {
                    company_id,
                    status: { [Op.in]: ['pendiente', 'en_transito'] },
                    [Op.or]: [{ from_location_id: wh.id }, { to_location_id: wh.id }],
                },
                transaction: t,
            });
            if (openTransfer) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'No puedes eliminar una bodega con traspasos pendientes o en tránsito.',
                });
            }

            // 🔹 Soft-delete con auditoría (el hook exige userId).
            await wh.destroy({ userId: req.user.id, transaction: t });

            await t.commit();

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Bodega eliminada exitosamente',
                id: wh.id,
            });
        } catch (error) {
            await t.rollback();
            console.error('❌ Error al eliminar la bodega:', error);
            if (error.message && error.message.includes('Se requiere un userId')) {
                return res.status(400).json({ success: false, status: 400, message: 'Error de auditoría: usuario no identificado para la eliminación.' });
            }
            return res.status(500).json({ success: false, status: 500, message: 'Error al eliminar la bodega' });
        }
    },
};
