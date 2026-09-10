const jwt = require('jsonwebtoken');
const { users, user_companies, companies, roles, permissions } = require('../models');
const { CODIGOS } = require('../utils/sincronizacion');

/**
 * 🔑 Por qué estas respuestas llevan un `code`
 *
 * Este middleware responde **403 para absolutamente todo**: sin token, token caducado, firma
 * inválida, membresía perdida y permiso insuficiente. Nunca un 401. Para un humano mirando la
 * pantalla da igual —lee el mensaje—, pero la **cola de reenvío offline** (ver `OFFLINE-CAMPO.md`)
 * tiene que decidir sola entre tres cosas muy distintas:
 *
 *   - `SESION_EXPIRADA` / `SESION_*` → **pausar** la cola y pedir reautenticación. El trabajo
 *     pendiente es bueno y se enviará en cuanto el vendedor vuelva a entrar.
 *   - `SIN_PERMISO`                  → **descartar**: reintentar mil veces no va a cambiar nada.
 *   - 5xx                            → **reintentar** con backoff. Es un problema del servidor.
 *
 * Sin el código, las tres llegan como 403 y solo se distinguen por un texto en español que puede
 * cambiar en cualquier momento. El `code` es aditivo: quien solo lea `message` no nota nada.
 *
 * ⚠️ NO convertir estos 403 en 401 "porque es lo correcto en HTTP": `client/src/services/api.ts`
 * tiene una rama para el 401 que **borra el token del localStorage**, y activarla destruiría la
 * credencial que la cola necesita para enviar el trabajo pendiente.
 */
const verifyToken = async (req, res, next) => {
    let token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({
            success: false,
            status: 403,
            code: CODIGOS.SESION_AUSENTE,
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
                    // La fila de `user_companies` activa ya no existe: al usuario lo desactivaron,
                    // lo sacaron de la compañía o le cambiaron el rol. El token sigue siendo válido
                    // criptográficamente, pero la sesión ya no vale: hay que volver a entrar.
                    code: CODIGOS.SESION_REVOCADA,
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
                    // La fila de `user_companies` activa ya no existe: al usuario lo desactivaron,
                    // lo sacaron de la compañía o le cambiaron el rol. El token sigue siendo válido
                    // criptográficamente, pero la sesión ya no vale: hay que volver a entrar.
                    code: CODIGOS.SESION_REVOCADA,
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
        // 🔴 Este `try` no envuelve solo a `jwt.verify`: envuelve también las consultas a
        // `user_companies`, `companies`, `roles` y `permissions`. Antes, TODO lo que cayera aquí
        // respondía 403 "Token inválido o expirado" — incluido un fallo transitorio de la base de
        // datos. O sea que un hipo de Cloud SQL se le presentaba al usuario como "tu sesión no
        // vale", y a la cola de reenvío le habría dicho "pausa y pide reautenticación" cuando lo
        // correcto era reintentar en un minuto.
        //
        // Se separan los dos casos por el tipo de error. `jsonwebtoken` lanza siempre alguna de
        // estas tres clases (comprobado): TokenExpiredError, NotBeforeError y JsonWebTokenError,
        // que es la base de las otras dos.
        const esErrorDeToken = error instanceof jwt.JsonWebTokenError;

        if (!esErrorDeToken) {
            console.error('Error del servidor al verificar la sesión:', error);
            return res.status(500).json({
                success: false,
                status: 500,
                message: "Error interno del servidor al verificar la sesión"
            });
        }

        // Caducado se separa del resto a propósito: es el único caso ESPERADO y con solución
        // obvia (volver a entrar). Los demás son token corrupto, manipulado o firmado con otra
        // clave, y merecen mirarse si aparecen en los logs.
        const expirado = error instanceof jwt.TokenExpiredError;
        if (!expirado) console.error('Token rechazado:', error.name, error.message);

        return res.status(403).json({
            success: false,
            status: 403,
            code: expirado ? CODIGOS.SESION_EXPIRADA : CODIGOS.SESION_INVALIDA,
            message: expirado ? "Tu sesión expiró. Vuelve a iniciar sesión." : "Token inválido o expirado"
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
                code: CODIGOS.SESION_AUSENTE,
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
            // 🔑 El código que la cola de reenvío necesita para NO reintentar: reintentar mil
            // veces no le va a dar el permiso. Se descarta y se le explica al vendedor.
            code: CODIGOS.SIN_PERMISO,
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
                // Llegar aquí significa que `verifyToken` no corrió antes en la cadena: para el
                // cliente es lo mismo que no haber mandado sesión.
                code: CODIGOS.SESION_AUSENTE,
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
            code: CODIGOS.SIN_PERMISO,
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
                // Llegar aquí significa que `verifyToken` no corrió antes en la cadena: para el
                // cliente es lo mismo que no haber mandado sesión.
                code: CODIGOS.SESION_AUSENTE,
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
            code: CODIGOS.SIN_PERMISO,
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