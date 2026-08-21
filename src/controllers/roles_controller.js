const { roles, companies, role_permissions, permissions, user_companies, users } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../models');



/**
 * Obtener roles para creación de usuarios (excluye SUPER_ADMIN)
 * Para owners que crean colaboradores
 */
const getRolesForUserCreation = async (req, res) => {
    try {
        // 🔒 Compañía SIEMPRE desde la sesión (no del path) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;

        // Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Empresa no encontrada',
                roles: []
            });
        }

        // Obtener roles excluyendo SUPER_ADMIN
        const rolesList = await roles.findAll({
            where: {
                [Op.and]: [
                    { is_active: true },
                    {
                        [Op.or]: [
                            { company_id: null }, // Roles globales
                            { company_id: companyId } // Roles específicos de la empresa
                        ]
                    },
                    {
                        name: { [Op.ne]: 'SUPER_ADMIN' }, // Excluir SUPER_ADMIN                     
                    }
                ]
            },
            order: [
                ['is_global', 'DESC'], // Roles globales primero
                ['name', 'ASC'] // Luego ordenar por nombre
            ]
        });

        // Formatear roles para satisfacer la interfaz del frontend
        const formattedRoles = rolesList.map(role => ({
            id: role.id,
            name: role.name,
            label: role.label,
            description: role.description,
            isGlobal: role.is_global,
            companyId: role.company_id
        }));

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Roles para creación obtenidos exitosamente',
            roles: formattedRoles
        });

    } catch (error) {
        console.error('❌ [RolesController] Error al obtener roles para creación:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor',
            roles: []
        });
    }
};

/**
 * Obtener roles disponibles para una empresa específica
 * Incluye roles globales (company_id = NULL) y roles propios de la empresa
 */
const getRolesByCompany = async (req, res) => {
    try {
        // 🔒 Compañía SIEMPRE desde la sesión (no del path) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;

        // Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Datos inconsistentes',
                roles: []
            });
        }

        // Obtener roles globales y roles de la empresa específica
        const rolesList = await roles.findAll({
            where: {
                [Op.or]: [
                    { company_id: null }, // Roles globales
                    { company_id: companyId } // Roles específicos de la empresa
                ]
            },
            order: [
                ['is_global', 'DESC'], // Roles globales primero
                ['name', 'ASC'] // Luego ordenar por nombre
            ]
        });

        // Formatear roles para satisfacer la interfaz del frontend
        const formattedRoles = rolesList.map(role => ({
            id: role.id,
            name: role.name,
            label: role.label,
            description: role.description,
            isGlobal: role.is_global,
            companyId: role.company_id
        }));

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Roles obtenidos exitosamente',
            roles: formattedRoles
        });

    } catch (error) {
        console.error('❌ [RolesController] Error al obtener roles:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor',
            roles: []
        });
    }
};


/**
 * Obtener permisos de un rol específico
 */
const getRolePermissions = async (req, res) => {
    try {
        const { roleId } = req.params;
        // 🔒 Compañía SIEMPRE desde la sesión (no del query) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;


        // Verificar que el rol existe
        const role = await roles.findByPk(roleId);
        if (!role) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Rol no encontrado',
                permissions: []
            });
        }

        // Obtener permisos del rol
        const rolePermissions = await role_permissions.findAll({
            where: {
                role_id: roleId,
                company_id: companyId
            },
            attributes: ['permission_id']
        });


        // Extraer solo los IDs de permisos
        const permissionIds = rolePermissions.map(rp => rp.permission_id);

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Permisos del rol obtenidos exitosamente',
            permissions: permissionIds
        });

    } catch (error) {
        console.error('❌ [RolesController] Error al obtener permisos del rol:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor',
            permissions: []
        });
    }
};

/**
 * Actualizar un rol personalizado de una empresa
 */
const updateCompanyRole = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { roleName, roleDescription, permissions: rolePermissions } = req.body;
        // 🔒 Compañía SIEMPRE desde la sesión (no del query) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;


        // 1. Validar que todos los datos requeridos estén presentes
        if (!roleId || !roleName || !roleDescription || !rolePermissions || !companyId) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Faltan datos requeridos para actualizar el rol'
            });
        }

        // 2. Verificar que el rol existe y pertenece a la empresa
        const existingRole = await roles.findOne({
            where: {
                id: roleId,
                company_id: companyId
            }
        });

        if (!existingRole) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Rol no encontrado o no pertenece a esta empresa'
            });
        }

        // 3. Verificar que no es un rol global (no se puede editar)
        if (existingRole.is_global) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'No se pueden editar roles globales del sistema'
            });
        }

        // 4. Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Empresa no encontrada'
            });
        }

        // 5. Validar que los permisos existen y están activos
        const validPermissions = await permissions.findAll({
            where: {
                id: rolePermissions,
                is_active: true
            }
        });

        if (validPermissions.length !== rolePermissions.length) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Algunos permisos no existen o están inactivos'
            });
        }

        // 6. Verificar si ya existe otro rol con el mismo nombre (excluyendo el actual)
        const normalizedNameForSearch = roles.normalizeName(roleName);
        const duplicateRole = await roles.findOne({
            where: {
                [Op.and]: [
                    { name: normalizedNameForSearch },
                    { id: { [Op.ne]: roleId } }, // Excluir el rol actual
                    {
                        [Op.or]: [
                            { company_id: companyId },
                            { company_id: null }
                        ]
                    }
                ]
            }
        });

        if (duplicateRole) {
            return res.status(409).json({
                success: false,
                status: 409,
                message: `Ya existe un rol con el nombre "${roleName}"`
            });
        }

        // 7. Iniciar transacción para actualizar rol y permisos
        const transaction = await sequelize.transaction();

        try {
            // 8. Actualizar el rol
            const updatedRole = await existingRole.update({
                name: roleName || existingRole.name,              // Los hooks normalizarán automáticamente
                label: roleName || existingRole.label,             // Los hooks normalizarán automáticamente
                description: roleDescription || existingRole.description
            }, { transaction });



            // 9. Eliminar permisos existentes del rol
            await role_permissions.destroy({
                where: {
                    role_id: roleId,
                    company_id: companyId
                },
                transaction
            });



            // 10. Asignar nuevos permisos
            const rolePermissionsData = rolePermissions.map(permissionId => ({
                role_id: roleId,
                permission_id: permissionId,
                company_id: companyId
            }));

            await role_permissions.bulkCreate(rolePermissionsData, { transaction });

            // 11. Confirmar transacción
            await transaction.commit();

            // 12. Retornar respuesta exitosa
            res.status(200).json({
                success: true,
                status: 200,
                message: "Rol actualizado exitosamente",
                role: {
                    id: updatedRole.id,
                    name: updatedRole.name,
                    label: updatedRole.label,
                    description: updatedRole.description,
                    isGlobal: updatedRole.is_global,
                    companyId: updatedRole.company_id
                }
            });

        } catch (transactionError) {
            // 13. Rollback en caso de error
            await transaction.rollback();
            console.error('❌ [RolesController] Error en transacción de actualización:', transactionError);

            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al actualizar el rol. Se revirtieron los cambios.'
            });
        }

    } catch (error) {
        console.error('❌ [RolesController] Error al actualizar rol personalizado:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Eliminar un rol personalizado de una empresa
 */
const deleteCompanyRole = async (req, res) => {
    try {
        const { roleId } = req.params;
        // 🔒 Compañía SIEMPRE desde la sesión (no del query) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;

        // 1. Validar que todos los datos requeridos estén presentes
        if (!roleId || !companyId) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Faltan datos requeridos para eliminar rol'
            });
        }

        // 2. Verificar que el rol existe y pertenece a la empresa
        const existingRole = await roles.findOne({
            where: {
                id: roleId,
                company_id: companyId
            }
        });

        if (!existingRole) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'El rol no se encontró o no pertenece a esta empresa'
            });
        }

        // 3. Verificar que no es un rol global (no se puede eliminar)
        if (existingRole.is_global) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'No se pueden eliminar roles globales del sistema'
            });
        }

        // 4. Verificar que la empresa existe
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Empresa no encontrada'
            });
        }

        // 5. Verificar que no hay usuarios asignados a este rol
        const usersWithRole = await user_companies.findAll({
            where: {
                role_id: roleId,
                status: 'active'
            },
            include: [{
                model: users,
                as: 'user',
                attributes: ['id', 'first_name', 'last_name', 'email']
            }]
        });

        if (usersWithRole.length > 0) {
            const usersList = usersWithRole.map(uc => {
                const fullName = uc.user.first_name && uc.user.last_name
                    ? `${uc.user.first_name} ${uc.user.last_name}`
                    : uc.user.email;
                return fullName;
            }).join(', ');
            return res.status(409).json({
                success: false,
                status: 409,
                message: `No se puede eliminar el rol porque está asignado a ${usersWithRole.length} usuario(s): ${usersList.length > 100 ? usersList.substring(0, 100) + '...' : usersList}`,
                assignedUsers: usersWithRole.length
            });
        }

        // 6. Iniciar transacción para eliminar rol y permisos
        const transaction = await sequelize.transaction();

        try {
            // 7. Eliminar permisos del rol
            await role_permissions.destroy({
                where: {
                    role_id: roleId,
                    company_id: companyId
                },
                transaction
            });


            // 8. Eliminar el rol
            await existingRole.destroy({ transaction });



            // 9. Confirmar transacción
            await transaction.commit();

            // 10. Retornar respuesta exitosa
            res.status(200).json({
                success: true,
                status: 200,
                message: "Rol eliminado exitosamente"
            });

        } catch (transactionError) {
            // 11. Rollback en caso de error
            await transaction.rollback();
            console.error('❌ [RolesController] Error en transacción de eliminación:', transactionError);

            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al eliminar el rol. Se revirtieron los cambios.'
            });
        }

    } catch (error) {
        console.error('❌ [RolesController] Error al eliminar rol personalizado:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};


/**
 * Crear un nuevo rol personalizado para una empresa
 */
const createCompanyRole = async (req, res) => {

    try {
        // 🔒 Compañía SIEMPRE desde la sesión (no del path) → cierra IDOR multi-tenant.
        const companyId = req.user.companyId;
        const { roleName, roleDescription, permissions } = req.body;

        // PASO A PASO PARA CREAR ROL Y ASIGNAR PERMISOS:

        // 1. Validar que lleguen todos los datos requeridos
        if (!companyId || !roleName || !roleDescription || !permissions) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Faltan datos requeridos para crear el rol'
            });
        }

        // 2. Verificar que la empresa existe en la base de datos
        //    - Buscar la empresa por ID
        //    - Si no existe, retornar error 404
        const company = await companies.findByPk(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'La compañia no existe en la base de datos'
            });
        }

        // 3. Validar que el nombre del rol no esté duplicado
        //    - Normalizar nombre SOLO para la búsqueda de duplicados
        //    - NO almacenar el valor normalizado (los hooks se encargarán)
        //    - Verificar duplicados para la misma empresa y roles globales
        const normalizedNameForSearch = roles.normalizeName(roleName);



        const existingRole = await roles.findOne({
            where: {
                name: normalizedNameForSearch,
                [Op.or]: [
                    { company_id: companyId },  // Roles de la misma empresa
                    { company_id: null }        // Roles globales
                ]
            }
        });

        if (existingRole) {
            const roleType = existingRole.company_id === null ? 'global' : 'de la empresa';
            return res.status(409).json({
                success: false,
                status: 409,
                message: `Ya existe un rol ${roleType} con el nombre "${roleName}"`
            });
        }

        // 4. Validar que todos los permisos existan
        //    - Verificar que cada ID de permiso del array existe en la tabla permissions
        //    - Verificar que todos los permisos estén activos (is_active = true)
        //    - Si algún permiso no existe, retornar error 400
        const { permissions: permissionsModel } = require('../models');

        if (!Array.isArray(permissions) || permissions.length === 0) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Debe seleccionar al menos un permiso para el rol'
            });
        }

        // Verificar que todos los permisos existan y estén activos
        const validPermissions = await permissionsModel.findAll({
            where: {
                id: permissions,
                is_active: true
            }
        });

        if (validPermissions.length !== permissions.length) {
            const validIds = validPermissions.map(p => p.id);
            const invalidIds = permissions.filter(id => !validIds.includes(id));

            return res.status(400).json({
                success: false,
                status: 400,
                message: `Los siguientes permisos no existen o están inactivos: ${invalidIds.join(', ')}`
            });
        }



        // 5. Crear el rol en la base de datos usando transacción
        //    - Insertar en la tabla roles con los datos normalizados
        //    - Usar transacción para asegurar consistencia

        const transaction = await sequelize.transaction();

        try {
            // Crear el rol - Los hooks del modelo se encargarán de normalizar automáticamente
            const newRole = await roles.create({
                name: roleName,              // ✅ Valor original - los hooks normalizarán
                label: roleName,             // ✅ Valor original - los hooks normalizarán  
                description: roleDescription,
                is_global: false,           // Siempre false para roles de empresa
                company_id: companyId,
                is_active: true
            }, { transaction });



            // 6. Asignar permisos al rol creado
            const rolePermissionsData = permissions.map(permissionId => ({
                role_id: newRole.id,
                permission_id: permissionId,
                company_id: companyId
            }));

            await role_permissions.bulkCreate(rolePermissionsData, { transaction });



            // Confirmar transacción
            await transaction.commit();

            // 7. Retornar respuesta exitosa con el rol creado
            res.status(201).json({
                success: true,
                status: 201,
                message: `Rol "${newRole.label}" creado exitosamente con ${permissions.length} permisos`,
                role: {
                    id: newRole.id,
                    name: newRole.name,
                    label: newRole.label,
                    description: newRole.description,
                    isGlobal: newRole.is_global,
                    companyId: newRole.company_id
                }
            });

        } catch (transactionError) {
            // 9. Rollback en caso de error
            await transaction.rollback();

            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al crear el rol. Se revirtieron los cambios.'
            });
        }

    } catch (error) {
        console.error('❌ [RolesController] Error al crear rol personalizado:', error);
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error interno del servidor'
        });
    }
};









module.exports = {
    getRolesByCompany,
    getRolesForUserCreation,
    createCompanyRole,
    getRolePermissions,
    updateCompanyRole,
    deleteCompanyRole
}; 