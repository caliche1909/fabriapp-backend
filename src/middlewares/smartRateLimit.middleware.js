const rateLimit = require('express-rate-limit');

/**
 * 🎯 MIDDLEWARE DE RATE LIMITING INTELIGENTE
 * 
 * Características:
 * - Endpoints públicos: Límite por IP (más estricto)
 * - Endpoints protegidos: Límite por usuario autenticado (más generoso)
 * - Límites diferenciados por tipo de operación
 * - Soporte para usuarios móviles (vendedores)
 */

// 🎯 MAPAS DE LIMITADORES PRE-CREADOS
const limitersCache = new Map();

// 🏗️ FUNCIÓN PRINCIPAL PARA CREAR RATE LIMITERS (AHORA CON CACHE)
const createSmartRateLimit = (options) => {
    const {
        windowMs = 15 * 60 * 1000,   // 15 minutos por defecto
        maxByIP = 20,               // Por IP sin autenticar
        maxByUser = 60,             // Por usuario autenticado
        message = "Demasiadas peticiones, intente más tarde",
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        enableOwnerBonus = true,      // Los OWNERS tienen límites más generosos
        trustedIPs = []               // IPs confiables (tu equipo)
    } = options;

    // 🎯 CREAR CLAVE ÚNICA PARA EL CACHE
    const cacheKey = JSON.stringify({
        windowMs,
        maxByIP,
        maxByUser,
        message,
        skipSuccessfulRequests,
        skipFailedRequests,
        enableOwnerBonus,
        trustedIPs: trustedIPs.sort()
    });

    // 🔄 VERIFICAR SI YA EXISTE EN CACHE
    if (limitersCache.has(cacheKey)) {
        return limitersCache.get(cacheKey);
    }

    // 🆕 CREAR NUEVA INSTANCIA Y GUARDAR EN CACHE
    const limiter = rateLimit({
        windowMs,
        
        // 🎯 CLAVE INTELIGENTE: Decide qué usar como identificador
        keyGenerator: (req) => {
            // 1. Si hay usuario autenticado, usar su ID
            if (req.user && req.user.id) {
                return `user:${req.user.id}`;
            }
            
            // 2. Si es endpoint público, usar IP
            return `ip:${req.ip}`;
        },
        
        // 🎯 LÍMITE DINÁMICO: Diferentes límites según el contexto
        max: (req) => {
            // 1. IPs confiables: límite muy alto
            if (trustedIPs.includes(req.ip)) {
                return maxByUser * 10;
            }
            
            // 2. Usuario autenticado
            if (req.user && req.user.id) {
                let userLimit = maxByUser;
                
                // 3. OWNERS obtienen límite más generoso
                if (enableOwnerBonus && req.user.userType === 'owner') {
                    userLimit = Math.floor(maxByUser * 1.5);
                }
                
                return userLimit;
            }
            
            // 4. IP sin autenticar: límite más estricto
            return maxByIP;
        },
        
        // 📝 Mensaje de respuesta personalizado
        message: (req) => {
            const isAuthenticated = req.user && req.user.id;
            const identifier = isAuthenticated 
                ? `usuario ${req.user.email}` 
                : `IP ${req.ip}`;
                
            return {
                success: false,
                status: 429,
                message: `${message} (${identifier})`,
                retryAfter: Math.ceil(windowMs / 1000 / 60) + " minutos"
            };
        },
        
        skipSuccessfulRequests,
        skipFailedRequests,
        
        // 🎯 SKIP PERSONALIZADO
        skip: (req) => {
            // Nunca skipear, siempre aplicar algún límite
            return false;
        },
        
        // 📊 Headers de información
        standardHeaders: true,
        legacyHeaders: false,
        
        // 🔄 Handler personalizado para debugging
        handler: (req, res) => {
            const isAuthenticated = req.user && req.user.id;
            const identifier = isAuthenticated 
                ? `Usuario: ${req.user.email} (ID: ${req.user.id})` 
                : `IP: ${req.ip}`;
            
            console.warn(`🚫 Rate limit exceeded - ${identifier} - Endpoint: ${req.method} ${req.path}`);
            
            return res.status(429).json({
                success: false,
                status: 429,
                message: `${message}`,
                details: {
                    identifier: isAuthenticated ? req.user.email : req.ip,
                    retryAfter: Math.ceil(windowMs / 1000 / 60) + " minutos",
                    endpoint: `${req.method} ${req.path}`
                }
            });
        }
    });

    // 💾 GUARDAR EN CACHE
    limitersCache.set(cacheKey, limiter);
    return limiter;
};

// 🏗️ CONFIGURACIONES PREDEFINIDAS PARA DIFERENTES TIPOS DE ENDPOINTS

// 🔐 LOGIN - Muy restrictivo por IP
const createLoginLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,     // 15 minutos
        maxByIP: 5,                   // 5 intentos por IP
        maxByUser: 5,                 // 5 intentos por usuario (no debería llegar aquí)
        message: "Demasiados intentos de login, intente más tarde",
        skipFailedRequests: false,    // Contar intentos fallidos
        ...customOptions
    });
};

// 🏢 REGISTRO DE EMPRESA - Muy restrictivo
const createCompanyRegistrationLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 horas
        maxByIP: 3,                     // 3 empresas por día por IP
        maxByUser: 3,                   // 3 empresas por día por usuario
        message: "Límite diario de registro de empresas alcanzado",
        enableOwnerBonus: false,        // No bonus para este caso
        ...customOptions
    });
};

// 👤 CREACIÓN DE USUARIOS - Moderadamente restrictivo
const createUserCreationLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 5,                    // 5 usuarios por hora por IP
        maxByUser: 15,                 // 15 usuarios por hora por usuario autenticado
        message: "Límite de creación de usuarios alcanzado",
        ...customOptions
    });
};

// 🏪 CREACIÓN DE TIENDAS - Moderado
const createStoreCreationLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 10,                   // 10 tiendas por hora por IP
        maxByUser: 25,                 // 25 tiendas por hora por usuario
        message: "Límite de creación de tiendas alcanzado",
        ...customOptions
    });
};

// 📦 CREACIÓN DE INSUMOS - Moderado
const createSupplyCreationLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 15,                   // 15 insumos por hora por IP
        maxByUser: 40,                 // 40 insumos por hora por usuario
        message: "Límite de creación de insumos alcanzado",
        ...customOptions
    });
};

// 🖼️ SUBIDA DE IMÁGENES - Moderado pero permite ráfagas
const createImageUploadLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 20,                   // 20 imágenes por hora por IP
        maxByUser: 60,                 // 60 imágenes por hora por usuario
        message: "Límite de subida de imágenes alcanzado",
        skipSuccessfulRequests: true,   // Solo contar uploads fallidos
        ...customOptions
    });
};

// 🔄 OPERACIONES GENERALES - Límite alto para operaciones normales
const createGeneralLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 50,                   // 50 peticiones por IP
        maxByUser: 100 ,                // 100 peticiones por usuario
        message: "Límite general de peticiones alcanzado",
        ...customOptions
    });
};

// 📱 OPERACIONES MÓVILES (para vendedores) - Muy generoso
const createMobileLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 30,                   // 30 por IP (para casos sin token)
        maxByUser: 300,                // 300 por usuario (muy generoso)
        message: "Límite de peticiones desde dispositivo móvil alcanzado",
        enableOwnerBonus: true,        // Bonus para owners
        ...customOptions
    });
};

// 🔍 CONSULTAS DE DATOS - Muy generoso
const createQueryLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 100,                  // 100 consultas por IP
        maxByUser: 200,                // 200 consultas por usuario
        message: "Límite de consultas alcanzado",
        skipSuccessfulRequests: true,  // Solo contar consultas fallidas
        ...customOptions
    });
};

// 📋 LISTAR RUTAS POR COMPAÑÍA - Moderado (se guarda en Redux)
const createListRoutesByCompanyLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 15,                   // 15 consultas por IP
        maxByUser: 40,                 // 40 consultas por usuario (se guarda en Redux)
        message: "Límite de consulta de rutas alcanzado",
        skipSuccessfulRequests: true,  // Solo contar consultas fallidas
        enableOwnerBonus: true,        // OWNERS: 60 consultas/15min
        ...customOptions
    });
};

// 🛣️ CREAR RUTA - Restrictivo (operación deliberada de configuración)
const createCreateRouteLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 3,                    // 3 rutas por hora por IP
        maxByUser: 10,                 // 10 rutas por hora por usuario
        message: "Límite de creación de rutas alcanzado",
        enableOwnerBonus: true,        // OWNERS: 15 rutas/hora
        ...customOptions
    });
};

// ✏️ ACTUALIZAR RUTA - Moderado (ajustes de rutas existentes)
const createUpdateRouteLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 10,                   // 10 actualizaciones por IP
        maxByUser: 30,                 // 30 actualizaciones por usuario
        message: "Límite de actualización de rutas alcanzado",
        enableOwnerBonus: true,        // OWNERS: 45 actualizaciones/15min
        ...customOptions
    });
};

// 🗑️ ELIMINAR RUTA - Muy restrictivo (operación crítica, afecta logística)
const createDeleteRouteLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 60 * 60 * 1000,      // 1 hora
        maxByIP: 2,                    // 2 eliminaciones por hora por IP
        maxByUser: 5,                  // 5 eliminaciones por hora por usuario
        message: "Límite de eliminación de rutas alcanzado",
        enableOwnerBonus: true,        // OWNERS: 7 eliminaciones/hora
        skipSuccessfulRequests: false, // Contar todas las eliminaciones
        ...customOptions
    });
};

// 🏪 CATÁLOGO TIPOS DE TIENDA - Generoso (se guarda en Redux)
const createStoreTypesCatalogLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,      // 15 minutos
        maxByIP: 30,                   // 30 consultas por IP
        maxByUser: 75,                 // 75 consultas por usuario (se guarda en Redux)
        message: "Límite de consulta de tipos de tienda alcanzado",
        skipSuccessfulRequests: true,  // Solo contar consultas fallidas
        enableOwnerBonus: true,        // OWNERS: 110 consultas/15min
        ...customOptions
    });
};

module.exports = {
    createSmartRateLimit, // Rate limiting inteligente
    createLoginLimiter, // Login - Muy restrictivo por IP
    createCompanyRegistrationLimiter, // Registro de empresa - Muy restrictivo
    createUserCreationLimiter, // Creación de usuarios - Moderadamente restrictivo
    createStoreCreationLimiter, // Creación de tiendas - Moderado
    createSupplyCreationLimiter, // Creación de insumos - Moderado
    createImageUploadLimiter, // Subida de imágenes - Moderado pero permite ráfagas
    createGeneralLimiter, // Operaciones generales - Límite alto para operaciones normales
    createMobileLimiter, // Operaciones móviles (para vendedores) - Muy generoso
    createQueryLimiter, // Consultas de datos - Muy generoso
    // 🛣️ LIMITADORES ESPECÍFICOS PARA RUTAS
    createListRoutesByCompanyLimiter, // Lista de rutas por compañía - Moderado
    createCreateRouteLimiter, // Crear ruta - Restrictivo
    createUpdateRouteLimiter, // Actualizar ruta - Moderado
    createDeleteRouteLimiter, // Eliminar ruta - Muy restrictivo
    // 🏪 LIMITADORES ESPECÍFICOS PARA CATÁLOGOS
    createStoreTypesCatalogLimiter // Catálogo tipos de tienda - Generoso
}; 