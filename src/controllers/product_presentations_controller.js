const { product_presentations } = require('../models');
const { Op } = require('sequelize');

/**
 * 🏷️ CONTROLADOR DE PRESENTACIONES DE PRODUCTOS
 *
 * Catálogo ligero por compañía con la etiqueta de venta ("Unidad", "Paq x8", "Paca x12x5").
 * Multi-tenant: aislado por `req.user.companyId`. Soft-delete paranoid con auditoría.
 *
 * Pensado para "creación al vuelo" desde el formulario de producto (Autocomplete freeSolo):
 * `createPresentation` es idempotente por nombre (si ya existe la devuelve, no duplica).
 */

const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ');

const formatPresentation = (p) => ({
    id: p.id,
    company_id: p.company_id,
    name: p.name,
    is_active: p.is_active,
    created_at: p.created_at,
    updated_at: p.updated_at
});

module.exports = {

    /**
     * 📋 GET /api/product_presentations/list — Presentaciones de la compañía. ?isActive=true|false opcional.
     */
    async getPresentations(req, res) {
        try {
            const company_id = req.user.companyId;
            const where = { company_id };
            if (req.query.isActive === 'true') where.is_active = true;
            else if (req.query.isActive === 'false') where.is_active = false;

            const rows = await product_presentations.findAll({ where, order: [['name', 'ASC']] });

            return res.status(200).json({
                success: true,
                status: 200,
                message: rows.length ? 'Presentaciones obtenidas exitosamente' : 'No se encontraron presentaciones',
                presentations: rows.map(formatPresentation)
            });
        } catch (error) {
            console.error('❌ Error al obtener presentaciones:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener las presentaciones', presentations: [] });
        }
    },

    /**
     * ➕ POST /api/product_presentations/create — Crea una presentación (nombre único por compañía).
     * IDEMPOTENTE (creación al vuelo): si ya existe una con ese nombre (viva), la devuelve con 200
     * en vez de fallar — así el Autocomplete freeSolo puede "crear o reutilizar" sin fricción.
     */
    async createPresentation(req, res) {
        try {
            const company_id = req.user.companyId;
            const cleanName = normalizeName(req.body.name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre de la presentación es obligatorio' });
            }
            if (cleanName.length > 60) {
                return res.status(400).json({ success: false, status: 400, message: 'La presentación no puede superar 60 caracteres' });
            }

            // Si ya existe (case-insensitive) la reutilizamos (idempotente).
            const existing = await product_presentations.findOne({
                where: { company_id, name: { [Op.iLike]: cleanName } }
            });
            if (existing) {
                return res.status(200).json({
                    success: true,
                    status: 200,
                    message: 'La presentación ya existía y fue reutilizada',
                    presentation: formatPresentation(existing)
                });
            }

            const created = await product_presentations.create({ company_id, name: cleanName, is_active: true });

            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Presentación creada exitosamente',
                presentation: formatPresentation(created)
            });
        } catch (error) {
            // Carrera: si dos peticiones crean el mismo nombre a la vez, la BD atrapa el duplicado.
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                const company_id = req.user.companyId;
                const existing = await product_presentations.findOne({
                    where: { company_id, name: { [Op.iLike]: normalizeName(req.body.name) } }
                });
                if (existing) {
                    return res.status(200).json({
                        success: true, status: 200,
                        message: 'La presentación ya existía y fue reutilizada',
                        presentation: formatPresentation(existing)
                    });
                }
            }
            console.error('❌ Error al crear la presentación:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo crear la presentación' });
        }
    },

    /**
     * ✏️ PUT /api/product_presentations/update/:id — Actualiza una presentación (scoped a la compañía).
     */
    async updatePresentation(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const presentation = await product_presentations.findOne({ where: { id, company_id } });
            if (!presentation) {
                return res.status(404).json({ success: false, status: 404, message: 'La presentación que intentas actualizar NO EXISTE' });
            }

            const cleanName = normalizeName(req.body.name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre de la presentación es obligatorio' });
            }

            const clash = await product_presentations.findOne({
                where: { company_id, name: { [Op.iLike]: cleanName }, id: { [Op.ne]: id } }
            });
            if (clash) {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe otra presentación con ese nombre' });
            }

            await presentation.update({
                name: cleanName,
                is_active: req.body.is_active === undefined ? presentation.is_active : !!req.body.is_active
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Presentación actualizada exitosamente',
                presentation: formatPresentation(presentation)
            });
        } catch (error) {
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe una presentación con ese nombre' });
            }
            console.error('❌ Error al actualizar la presentación:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo actualizar la presentación' });
        }
    },

    /**
     * 🗑️ DELETE /api/product_presentations/delete/:id — Soft-delete con auditoría.
     * Los productos que la usaban conservan su presentation_id apuntando a la presentación eliminada;
     * el include paranoid la ignorará y el producto aparecerá sin presentación.
     */
    async deletePresentation(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const presentation = await product_presentations.findOne({ where: { id, company_id } });
            if (!presentation) {
                return res.status(404).json({ success: false, status: 404, message: 'Esta presentación ya NO EXISTE' });
            }

            await presentation.destroy({ userId: req.user.id });

            return res.status(200).json({ success: true, status: 200, message: 'Presentación eliminada con éxito' });
        } catch (error) {
            console.error('❌ Error al eliminar la presentación:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo eliminar la presentación' });
        }
    }
};
