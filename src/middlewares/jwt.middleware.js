const jwt = require('jsonwebtoken');
const { users, user_companies, companies, roles, permissions } = require('../models');

const verifyToken = async (req, res, next) => {
    let token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ 
            success: false,
            message: "No Autorizado" 
        });
    }

    token = token.split(" ")[1];

    try {
        const { userId, email, companyId, roleId, userType } = jwt.verify(token, process.env.JWT_SECRET);       

        // 🔥 OPTIMIZACIÓN: Consulta diferenciada por userType
        let userCompany;
        
        if (userType === 'owner') {
            // 🏆 OWNER: Solo verificar que la relación existe (sin permisos)
            userCompany = await user_companies.findOne({
                where: { 
                    user_id: userId,
                    company_id: companyId,
                    role_id: roleId,
                    user_type: 'owner',
                    status: 'active'
                },
                include: [
                    {
                        model: companies,
                        as: 'company',
                        attributes: ['id', 'name', 'timezone', 'sales_inventory_mode']
                    },
                    {
                        model: roles,
                        as: 'role',
                        attributes: ['id', 'name']
                        // 🚀 NO incluir permisos para owners
                    }
                ]
            });

            if (!userCompany) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: "Acceso denegado: Debe iniciar sesión nuevamente"
                });
            }

            // 🔐 OWNER: Sin permisos específicos (acceso total)
            req.user = {
                id: userId,
                email: email,
                companyId: companyId,
                companyName: userCompany.company.name,
                // Zona horaria IANA de la compañía activa (Capa B). Se lee de la BD en cada
                // request (no del token) → siempre fresca. Fallback defensivo a Bogotá.
                companyTimezone: userCompany.company.timezone || 'America/Bogota',
                // Modo de ventas e inventarios de la compañía activa. Igual que la zona horaria:
                // se lee de la BD en cada request (no del token) → un cambio aplica de inmediato.
                companySalesInventoryMode: userCompany.company.sales_inventory_mode || 'sin_inventario',
                roleId: roleId,
                role: userCompany.role ? userCompany.role.name : 'OWNER',
                userType: 'owner',
                permissions: [] // OWNER no necesita permisos específicos
            };

        } else {
            // 👥 COLLABORATOR: Consultar permisos específicos
            userCompany = await user_companies.findOne({
                where: { 
                    user_id: userId,
                    company_id: companyId,
                    role_id: roleId,
                    user_type: 'collaborator',
                    status: 'active'
                },
                include: [
                    {
                        model: companies,
                        as: 'company',
                        attributes: ['id', 'name', 'timezone', 'sales_inventory_mode']
                    },
                    {
                        model: roles,
                        as: 'role',
                        include: [{
                            model: permissions,
                            as: 'permissions',
                            through: { attributes: [] },
                            attributes: ['code', 'name']
                        }]
                    }
                ]
            });

            if (!userCompany) {
                return res.status(403).json({
                    success: false,
                    status: 403,
                    message: "Acceso denegado: Debe iniciar sesión nuevamente"
                });
            }

            // 🔐 COLLABORATOR: Permisos específicos del rol
            const userPermissions = userCompany.role && userCompany.role.permissions 
                ? userCompany.role.permissions.map(p => p.code)
                : [];
            
            req.user = {
                id: userId,
                email: email,
                companyId: companyId,
                companyName: userCompany.company.name,
                // Zona horaria IANA de la compañía activa (Capa B). Se lee de la BD en cada
                // request (no del token) → siempre fresca. Fallback defensivo a Bogotá.
                companyTimezone: userCompany.company.timezone || 'America/Bogota',
                // Modo de ventas e inventarios de la compañía activa (ver la rama del owner).
                companySalesInventoryMode: userCompany.company.sales_inventory_mode || 'sin_inventario',
                roleId: roleId,
                role: userCompany.role ? userCompany.role.name : 'COLLABORATOR',
                userType: 'collaborator',
                permissions: userPermissions
            };
        }
      
        next();

    } catch (error) {
        console.error('Error en verificación de token:', error);
        return res.status(403).json({ 
            success: false,
            message: "Token inválido o expirado" 
        });
    }
};

// Verificar un permiso específico
const checkPermission = (permissionCode) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: "No autorizado"
            });
        }

        // 🏆 OWNER siempre tiene acceso total en su empresa
        if (req.user.userType === 'owner') {           
            return next();
        }

        // 👥 COLLABORATOR: Verificar permiso específico
        if (req.user.permissions.includes(permissionCode)) {          
            return next();
        }
    
        return res.status(403).json({
            success: false,
            status: 403,
            message: "No tiene permisos para acceder a este recurso"
        });
    };
};

// Verificar múltiples permisos (debe tener todos)
const checkPermissions = (permissionCodes) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: "No Autorizado"
            });
        }

        // 🏆 OWNER siempre tiene acceso total en su empresa
        if (req.user.userType === 'owner') {    
            return next();
        }

        // 👥 COLLABORATOR: Verificar todos los permisos
        const hasAllPermissions = permissionCodes.every(
            code => req.user.permissions.includes(code)
        );

        if (hasAllPermissions) {            
            return next();
        }

    
        return res.status(403).json({
            success: false,
            status: 403,
            message: "No tiene los permisos necesarios para acceder a este recurso"
        });
    };
};

// Verificar que tenga al menos uno de los permisos
const checkAnyPermission = (permissionCodes) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: "No Autorizado"
            });
        }

        // 🏆 OWNER siempre tiene acceso total en su empresa
        if (req.user.userType === 'owner') {    
            
            return next();
        }

        // 👥 COLLABORATOR: Verificar al menos un permiso
        const hasAtLeastOne = permissionCodes.some(
            code => req.user.permissions.includes(code)
        );

        if (hasAtLeastOne) {
            
            return next();
        }

        
        return res.status(403).json({
            success: false,
            status: 403,
            message: "No tiene los permisos necesarios para acceder a este recurso"
        });
    };
};

module.exports = {
    verifyToken,
    checkPermission,
    checkPermissions,
    checkAnyPermission
};