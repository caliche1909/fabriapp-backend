const { products, product_categories, product_presentations } = require('../models');
const { Op } = require('sequelize');

/**
 * 📦 CONTROLADOR DEL CATÁLOGO DE PRODUCTOS
 *
 * Productos terminados que la empresa vende (productos simples, sin variantes).
 * Multi-tenant: TODA operación se aísla por `req.user.companyId` (nunca se confía en el
 * company_id del cliente) → cierra IDOR. El stock NO se maneja aquí (vive en el módulo de
 * stock: product_stock_balances/movements); este controlador es solo el maestro del catálogo.
 */

// 🔧 Includes reutilizables para no repetir (DRY) y mantener consultas consistentes.
const PRODUCT_INCLUDES = [
    { model: product_categories, as: 'category', attributes: ['id', 'name'] },
    { model: product_presentations, as: 'presentation', attributes: ['id', 'name'] }
];

// 🔧 Normaliza el nombre: recorta y colapsa espacios internos (sin forzar mayúsculas;
//    los nombres de producto son de cara al cliente).
const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ');

// 🔧 Formateador único de salida: castea DECIMAL (que pg devuelve como string) a número
//    y expone una estructura estable para el frontend. Reusado en list/detail/create/update.
const formatProduct = (p) => ({
    id: p.id,
    company_id: p.company_id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    description: p.description,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    presentation: p.presentation ? { id: p.presentation.id, name: p.presentation.name } : null,
    sale_price: p.sale_price != null ? parseFloat(p.sale_price) : 0,
    production_cost: p.production_cost != null ? parseFloat(p.production_cost) : 0,
    min_stock: p.min_stock != null ? parseFloat(p.min_stock) : 0,
    is_active: p.is_active,
    image_url: p.image_url,
    created_at: p.created_at,
    updated_at: p.updated_at
});

// 🔧 Valida y castea un valor numérico monetario/cantidad. Devuelve { ok, value } o { ok:false }.
const toNonNegativeNumber = (raw, { required = false, defaultValue = 0 } = {}) => {
    if (raw === undefined || raw === null || raw === '') {
        return required ? { ok: false } : { ok: true, value: defaultValue };
    }
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) return { ok: false };
    return { ok: true, value: n };
};

module.exports = {

    /**
     * 📋 GET /api/products/list — Lista los productos de la compañía.
     * Filtros opcionales (query): ?search= (nombre o sku, ilike), ?categoryId=, ?isActive=true|false.
     * Devuelve todos los que cumplan (el frontend cachea en Redux). Ordenado por nombre.
     */
    async getProducts(req, res) {
        try {
            const company_id = req.user.companyId;

            const where = { company_id };

            // 🔎 Filtro de búsqueda (nombre o SKU) — usa índices por compañía.
            const search = (req.query.search || '').trim();
            if (search) {
                where[Op.or] = [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { sku: { [Op.iLike]: `%${search}%` } }
                ];
            }

            // 🔎 Filtro por categoría.
            if (req.query.categoryId) {
                where.category_id = req.query.categoryId;
            }

            // 🔎 Filtro por estado activo/inactivo.
            if (req.query.isActive === 'true') where.is_active = true;
            else if (req.query.isActive === 'false') where.is_active = false;

            const rows = await products.findAll({
                where,
                include: PRODUCT_INCLUDES,
                order: [['name', 'ASC']]
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: rows.length ? 'Productos obtenidos exitosamente' : 'No se encontraron productos',
                products: rows.map(formatProduct)
            });

        } catch (error) {
            console.error('❌ Error al obtener productos:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener los productos', products: [] });
        }
    },

    /**
     * 🔍 GET /api/products/detail/:id — Un producto por ID (scoped a la compañía).
     */
    async getProductById(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const product = await products.findOne({
                where: { id, company_id },
                include: PRODUCT_INCLUDES
            });

            if (!product) {
                return res.status(404).json({ success: false, status: 404, message: 'El producto no existe', product: null });
            }

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Producto obtenido exitosamente',
                product: formatProduct(product)
            });

        } catch (error) {
            console.error('❌ Error al obtener el producto:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener el producto', product: null });
        }
    },

    /**
     * ➕ POST /api/products/create — Crea un producto.
     * company_id SIEMPRE de la sesión. Valida categoría/unidad de la compañía y unicidad de SKU.
     * El trigger de BD siembra el balance 0 en la bodega central automáticamente.
     */
    async createProduct(req, res) {
        try {
            const company_id = req.user.companyId;
            const {
                name, sku, barcode, description,
                category_id, presentation_id, sale_price, production_cost, min_stock, is_active, image_url
            } = req.body;

            // 🔹 Nombre obligatorio.
            const cleanName = normalizeName(name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre del producto es obligatorio' });
            }

            // 🔹 Numéricos (opcionales, default 0, no negativos).
            const salePrice = toNonNegativeNumber(sale_price);
            const prodCost = toNonNegativeNumber(production_cost);
            const minStock = toNonNegativeNumber(min_stock);
            if (!salePrice.ok || !prodCost.ok || !minStock.ok) {
                return res.status(400).json({ success: false, status: 400, message: 'Precio, costo y stock mínimo deben ser números no negativos' });
            }

            // 🔹 Categoría/presentación (opcionales) deben pertenecer a la compañía.
            const cleanSku = sku ? String(sku).trim() : null;
            const validation = await validateCategoryPresentationAndSku({ company_id, category_id, presentation_id, sku: cleanSku });
            if (!validation.ok) {
                return res.status(validation.status).json({ success: false, status: validation.status, message: validation.message });
            }

            const created = await products.create({
                company_id,
                name: cleanName,
                sku: cleanSku,
                barcode: barcode ? String(barcode).trim() : null,
                description: description || null,
                category_id: category_id || null,
                presentation_id: presentation_id || null,
                sale_price: salePrice.value,
                production_cost: prodCost.value,
                min_stock: minStock.value,
                is_active: is_active === undefined ? true : !!is_active,
                image_url: image_url || null
            });

            // 🔹 Releer con asociaciones para una respuesta consistente.
            const product = await products.findByPk(created.id, { include: PRODUCT_INCLUDES });

            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Producto creado exitosamente',
                product: formatProduct(product)
            });

        } catch (error) {
            // 🛡️ Respaldo por si la unicidad de SKU la atrapa la BD (índice único parcial).
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe un producto con ese SKU en tu compañía' });
            }
            console.error('❌ Error al crear el producto:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo crear el producto' });
        }
    },

    /**
     * ✏️ PUT /api/products/update/:id — Actualiza un producto (scoped a la compañía).
     */
    async updateProduct(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;
            const {
                name, sku, barcode, description,
                category_id, presentation_id, sale_price, production_cost, min_stock, is_active, image_url
            } = req.body;

            // 🔒 Debe pertenecer a la compañía (cierra IDOR: checkPermission valida el permiso, no la pertenencia).
            const product = await products.findOne({ where: { id, company_id } });
            if (!product) {
                return res.status(404).json({ success: false, status: 404, message: 'El producto que intentas actualizar NO EXISTE' });
            }

            const cleanName = normalizeName(name);
            if (!cleanName) {
                return res.status(400).json({ success: false, status: 400, message: 'El nombre del producto es obligatorio' });
            }

            const salePrice = toNonNegativeNumber(sale_price);
            const prodCost = toNonNegativeNumber(production_cost);
            const minStock = toNonNegativeNumber(min_stock);
            if (!salePrice.ok || !prodCost.ok || !minStock.ok) {
                return res.status(400).json({ success: false, status: 400, message: 'Precio, costo y stock mínimo deben ser números no negativos' });
            }

            // 🔹 Validar categoría/presentación/SKU (excluyendo el propio producto en el SKU).
            const cleanSku = sku ? String(sku).trim() : null;
            const validation = await validateCategoryPresentationAndSku({ company_id, category_id, presentation_id, sku: cleanSku, excludeProductId: id });
            if (!validation.ok) {
                return res.status(validation.status).json({ success: false, status: validation.status, message: validation.message });
            }

            await product.update({
                name: cleanName,
                sku: cleanSku,
                barcode: barcode ? String(barcode).trim() : null,
                description: description || null,
                category_id: category_id || null,
                presentation_id: presentation_id || null,
                sale_price: salePrice.value,
                production_cost: prodCost.value,
                min_stock: minStock.value,
                is_active: is_active === undefined ? product.is_active : !!is_active,
                image_url: image_url !== undefined ? (image_url || null) : product.image_url
            });

            const updated = await products.findByPk(id, { include: PRODUCT_INCLUDES });

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Producto actualizado exitosamente',
                product: formatProduct(updated)
            });

        } catch (error) {
            if (error && error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ success: false, status: 409, message: 'Ya existe un producto con ese SKU en tu compañía' });
            }
            console.error('❌ Error al actualizar el producto:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo actualizar el producto' });
        }
    },

    /**
     * 🗑️ DELETE /api/products/delete/:id — Eliminación LÓGICA (soft-delete paranoid) con
     * auditoría (`deleted_by`). El historial de stock se conserva; el producto es restaurable.
     */
    async deleteProduct(req, res) {
        try {
            const company_id = req.user.companyId;
            const { id } = req.params;

            const product = await products.findOne({ where: { id, company_id } });
            if (!product) {
                return res.status(404).json({ success: false, status: 404, message: 'Este producto ya NO EXISTE' });
            }

            // El hook beforeDestroy exige options.userId para registrar quién eliminó (auditoría).
            await product.destroy({ userId: req.user.id });

            return res.status(200).json({ success: true, status: 200, message: 'Producto eliminado con éxito' });

        } catch (error) {
            console.error('❌ Error al eliminar el producto:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error! No se pudo eliminar el producto' });
        }
    }
};

/**
 * 🔧 Helper compartido: valida que (opcionalmente) la categoría y la presentación existan y
 * pertenezcan a la compañía, y que el SKU no colisione con otro producto vivo.
 * Devuelve { ok:true } o { ok:false, status, message }.
 */
async function validateCategoryPresentationAndSku({ company_id, category_id, presentation_id, sku, excludeProductId = null }) {
    // Categoría: si viene, debe ser de la compañía.
    if (category_id) {
        const category = await product_categories.findOne({ where: { id: category_id, company_id } });
        if (!category) {
            return { ok: false, status: 400, message: 'La categoría indicada no existe o no pertenece a tu compañía' };
        }
    }

    // Presentación: si viene, debe pertenecer a la compañía (aislamiento multi-tenant).
    if (presentation_id) {
        const presentation = await product_presentations.findOne({ where: { id: presentation_id, company_id } });
        if (!presentation) {
            return { ok: false, status: 400, message: 'La presentación indicada no existe o no pertenece a tu compañía' };
        }
    }

    // SKU único por compañía (entre los vivos), pre-chequeo para un 409 amigable.
    if (sku) {
        const where = { company_id, sku };
        if (excludeProductId) where.id = { [Op.ne]: excludeProductId };
        const clash = await products.findOne({ where });
        if (clash) {
            return { ok: false, status: 409, message: 'Ya existe un producto con ese SKU en tu compañía' };
        }
    }

    return { ok: true };
}
