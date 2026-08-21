const { companies } = require('../models');

/**
 * ⚙️ CONFIGURACIONES DE LA COMPAÑÍA (submódulo `general-settings`)
 *
 * Ajustes de OPERACIÓN de la compañía, separados de "Mi compañía" (datos fiscales, logo,
 * ubicación). Hoy solo hay uno: cómo afectan las ventas al inventario.
 *
 * Multi-tenant: la compañía SIEMPRE sale de la sesión (`req.user.companyId`), nunca del
 * cliente ni de la URL. Los permisos (`view_general_settings` / `manage_general_settings`)
 * se gatean en la ruta; el OWNER los bypassa.
 */

// Modos válidos de venta/inventario. Debe coincidir con el ENUM de la BD
// (`enum_companies_sales_inventory_mode`, migración 20260817120100) y con el tipo del frontend.
const SALES_INVENTORY_MODES = ['sin_inventario', 'descuenta_central', 'descuenta_bodegas'];

// 🔧 Da forma a las configuraciones para el frontend.
const formatSettings = (company) => ({
    sales_inventory_mode: company.sales_inventory_mode,
});

module.exports = {
    /**
     * 📋 GET /api/company_settings — Configuraciones de la compañía de la sesión.
     */
    async getCompanySettings(req, res) {
        try {
            const company = await companies.findByPk(req.user.companyId, {
                attributes: ['id', 'sales_inventory_mode'],
            });
            if (!company) {
                return res.status(404).json({ success: false, status: 404, message: 'La compañía no existe', settings: null });
            }

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Configuraciones obtenidas exitosamente',
                settings: formatSettings(company),
            });
        } catch (error) {
            console.error('❌ Error al obtener las configuraciones de la compañía:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al obtener las configuraciones', settings: null });
        }
    },

    /**
     * ✏️ PUT /api/company_settings — Actualiza las configuraciones de la compañía.
     * Body: { sales_inventory_mode }.
     *
     * Actualización PARCIAL: solo se aplica lo que venga en el body, así los ajustes que se
     * agreguen después no se pisan entre sí. Cambiar el modo NO reescribe el historial: las
     * ventas ya registradas conservan (o no) su bodega y sus movimientos tal como se hicieron.
     */
    async updateCompanySettings(req, res) {
        try {
            const company = await companies.findByPk(req.user.companyId);
            if (!company) {
                return res.status(404).json({ success: false, status: 404, message: 'La compañía no existe' });
            }

            const cambios = {};

            if (req.body.sales_inventory_mode !== undefined) {
                const modo = req.body.sales_inventory_mode;
                if (!SALES_INVENTORY_MODES.includes(modo)) {
                    return res.status(400).json({
                        success: false, status: 400,
                        message: 'Selecciona una forma válida de manejar las ventas y el inventario',
                    });
                }
                cambios.sales_inventory_mode = modo;
            }

            if (Object.keys(cambios).length === 0) {
                return res.status(400).json({ success: false, status: 400, message: 'No hay cambios para guardar' });
            }

            await company.update(cambios);

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Configuraciones actualizadas exitosamente',
                settings: formatSettings(company),
            });
        } catch (error) {
            console.error('❌ Error al actualizar las configuraciones de la compañía:', error);
            return res.status(500).json({ success: false, status: 500, message: 'Error al actualizar las configuraciones' });
        }
    },
};
