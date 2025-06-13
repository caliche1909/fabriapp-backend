const jwt = require('jsonwebtoken');
const { users, roles, permissions } = require('../models');

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
        const { email } = jwt.verify(token, process.env.JWT_SECRET);

        const user = await users.findOne({
            where: { email: email },
            include: [{
                model: roles,
                as: 'role',
                include: [{
                    model: permissions,
                    as: 'permissions',
                }]
            }]
        });

        if (!user) {
            return res.status(403).json({
                success: false,
                message: "Usuario no encontrado"
            });
        }
        
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role.name,
            permissions: user.role.permissions.map(p => p.code)
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
        if (!req.user || !req.user.permissions) {
            return res.status(403).json({
                success: false,
                message: "No autorizado"
            });
        }

        // SUPER_ADMIN siempre tiene acceso
        if (req.user.role === 'SUPER_ADMIN') {
            return next();
        }

        if (req.user.permissions.includes(permissionCode)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: "No tiene permiso para realizar esta acción"
        });
    };
};

// Verificar múltiples permisos (debe tener todos)
const checkPermissions = (permissionCodes) => {
    return (req, res, next) => {
        if (!req.user || !req.user.permissions) {
            return res.status(403).json({
                success: false,
                message: "No Autorizado"
            });
        }

        // SUPER_ADMIN siempre tiene acceso
        if (req.user.role === 'SUPER_ADMIN') {
            return next();
        }

        const hasAllPermissions = permissionCodes.every(
            code => req.user.permissions.includes(code)
        );

        if (hasAllPermissions) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: "No tiene los permisos necesarios"
        });
    };
};

// Verificar que tenga al menos uno de los permisos
const checkAnyPermission = (permissionCodes) => {
    return (req, res, next) => {
        if (!req.user || !req.user.permissions) {
            return res.status(403).json({
                success: false,
                message: "No Autorizado"
            });
        }

        // SUPER_ADMIN siempre tiene acceso
        if (req.user.role === 'SUPER_ADMIN') {
            return next();
        }

        const hasAtLeastOne = permissionCodes.some(
            code => req.user.permissions.includes(code)
        );

        if (hasAtLeastOne) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: "No tiene ninguno de los permisos necesarios"
        });
    };
};

module.exports = {
    verifyToken,
    checkPermission,
    checkPermissions,
    checkAnyPermission
};