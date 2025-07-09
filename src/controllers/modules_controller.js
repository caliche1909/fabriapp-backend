const { modules, submodules, permissions } = require('../models');

/**
 * Obtener todos los módulos con sus submódulos y permisos
 * Para usar en UserPermissions.tsx al crear roles personalizados
 */
const getModulesWithPermissions = async (req, res) => {
    try {
        console.log('🔧 [ModulesController] Obteniendo módulos con submódulos y permisos');

        // Obtener todos los módulos activos con sus submódulos y permisos
        const modulesList = await modules.findAll({
            where: {
                is_active: true
            },
            include: [
                {
                    model: submodules,
                    as: 'submodules',
                    where: {
                        is_active: true
                    },
                    required: false, // LEFT JOIN para incluir módulos sin submódulos
                    include: [
                        {
                            model: permissions,
                            as: 'permissions',
                            where: {
                                is_active: true
                            },
                            required: false, // LEFT JOIN para incluir submódulos sin permisos
                            attributes: ['id', 'name', 'code', 'description', 'is_active']
                        }
                    ],
                    attributes: ['id', 'name', 'code', 'description', 'route_path', 'is_active']
                }
            ],
            attributes: ['id', 'name', 'code', 'description', 'route_path', 'is_active'],
            order: [
                ['name', 'ASC'],
                [{ model: submodules, as: 'submodules' }, 'name', 'ASC'],
                [{ model: submodules, as: 'submodules' }, { model: permissions, as: 'permissions' }, 'name', 'ASC']
            ]
        });

        console.log('🔧 [ModulesController] Módulos encontrados:', modulesList.length);

        // Formatear módulos para satisfacer las interfaces del frontend
        const formattedModules = modulesList.map(module => ({
            id: module.id,
            name: module.name,
            code: module.code,
            description: module.description || '',
            route_path: module.route_path || '',
            is_active: module.is_active,
            submodules: module.submodules ? module.submodules.map(submodule => ({
                id: submodule.id,
                name: submodule.name,
                code: submodule.code,
                description: submodule.description || '',
                route_path: submodule.route_path || '',
                is_active: submodule.is_active,
                permissions: submodule.permissions ? submodule.permissions.map(permission => ({
                    id: permission.id,
                    name: permission.name,
                    code: permission.code,
                    description: permission.description || '',
                    isActive: permission.is_active
                })) : []
            })) : []
        }));

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Módulos obtenidos exitosamente',
            modules: formattedModules
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor',
            modules: []
        });
    }
};

module.exports = {
    getModulesWithPermissions
};
