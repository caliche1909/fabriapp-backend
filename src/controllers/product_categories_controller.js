const { product_categories, products } = require('../models');
const { Op } = require('sequelize');

/**
 * 🏷️ CONTROLADOR DE CATEGORÍAS DE PRODUCTOS
 *
 * Catálogo plano para agrupar/filtrar productos. Multi-tenant: aislado por
 * `req.user.companyId`. Soft-delete paranoid con auditoría (`deleted_by`).
 */

const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ');

const formatCategory = (c) => ({
    id: c.id,
    company_id: c.company_id,
    name: c.name,
    description: c.description,
    is_active: c.is_active,
    created_at: c.created_at,
    updated_at: c.updated_at
});

module.exports = {

    /**
     * 📋 GET /api/product_categories/list — Categorías de la compañía. ?isActive=true|false opcional.
     */
    async getCategories(req, res) {
        try {
            const company_id = req.user.companyId;
            const where = { company_id };
            if (req.query.isActive === 'true') where.is_active = true;
            else if (req.query.isActive === 'false') where.is_active = false;

            const rows = await product_categories.findAll({ where, order: [['name', 'ASC']] });

            return res.status(200).json({
                success: true,
                status: 200,
                message: rows.length ? 'Categorías obtenidas exitosamente' : 'No se encontraron categorías',
                categories: rows.map(formatCategory)
            });
        } catch (error) {
            console.error('❌ Error al obtener categorías:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener las categorías', categories: [] });
        }
    },

    /**
     * ➕ POST /api/product_categories/create — Crea una categoría (nombre único por compañía).
     */
    async createCategory(req, res) {
        try {
            const company_id = req.user.companyId;
            const cleanName = normalizeName(req.body.name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre de la categoría es obligatorio' });
            }

            // Pre-chequeo de duplicado (case-insensitive) para un 409 amigable; la BD lo respalda.
            const clash = await product_categories.findOne({
                where: { company_id, name: { [Op.iLike]: cleanName } }
            });
            if (clash) {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe una categoría con ese nombre' });
            }

            const created = await product_categories.create({
                company_id,
                name: cleanName,
                description: req.body.description || null,
                is_active: req.body.is_active === undefined ? true : !!req.body.is_active
            });

            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Categoría creada exitosamente',
                category: formatCategory(created)
            });
        } catch (error) {
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe una categoría con ese nombre' });
            }
            console.error('❌ Error al crear la categoría:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo crear la categoría' });
        }
    },

    /**
     * ✏️ PUT /api/product_categories/update/:id — Actualiza una categoría (scoped a la compañía).
     */
    async updateCategory(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const category = await product_categories.findOne({ where: { id, company_id } });
            if (!category) {
                return res.status(404).json({ success: false, status: 404, message: 'La categoría que intentas actualizar NO EXISTE' });
            }

            const cleanName = normalizeName(req.body.name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre de la categoría es obligatorio' });
            }

            // Duplicado con OTRA categoría de la compañía.
            const clash = await product_categories.findOne({
                where: { company_id, name: { [Op.iLike]: cleanName }, id: { [Op.ne]: id } }
            });
            if (clash) {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe otra categoría con ese nombre' });
            }

            await category.update({
                name: cleanName,
                description: req.body.description !== undefined ? (req.body.description || null) : category.description,
                is_active: req.body.is_active === undefined ? category.is_active : !!req.body.is_active
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Categoría actualizada exitosamente',
                category: formatCategory(category)
            });
        } catch (error) {
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe una categoría con ese nombre' });
            }
            console.error('❌ Error al actualizar la categoría:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo actualizar la categoría' });
        }
    },

    /**
     * 🗑️ DELETE /api/product_categories/delete/:id — Soft-delete con auditoría.
     * Los productos que la usaban conservan su category_id (apuntando a la categoría eliminada);
     * en las listas aparecerán sin categoría (el include paranoid ignora las eliminadas).
     */
    async deleteCategory(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const category = await product_categories.findOne({ where: { id, company_id } });
            if (!category) {
                return res.status(404).json({ success: false, status: 404, message: 'Esta categoría ya NO EXISTE' });
            }

            await category.destroy({ userId: req.user.id });

            return res.status(200).json({ success: true, status: 200, message: 'Categoría eliminada con éxito' });
        } catch (error) {
            console.error('❌ Error al eliminar la categoría:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo eliminar la categoría' });
        }
    }
};
