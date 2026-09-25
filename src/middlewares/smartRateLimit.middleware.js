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
        trustedIPs = [],              // IPs confiables (tu equipo)
        clavePorCorreo = false        // Contar por `body.email` en vez de por IP. Ver `keyGenerator`.
    } = options;

    // 🎯 CREAR CLAVE ÚNICA PARA EL CACHE
    //
    // 🔴 TODA OPCIÓN NUEVA TIENE QUE ENTRAR AQUÍ. Los limitadores se reutilizan cuando sus
    // opciones coinciden, así que una opción que no forme parte de esta clave hace que dos
    // limitadores DISTINTOS acaben siendo el mismo objeto y compartan cupo sin que nadie lo note.
    // Ya ha mordido dos veces en este repositorio —marcar visita compartía cupo con crear y
    // actualizar tienda, y anular un reporte se lo habría robado a los reportes—; los dos casos
    // están contados en `storesRoutes.js` y en `store_no_sale_reports_routes.js`.
    const cacheKey = JSON.stringify({
        windowMs,
        maxByIP,
        maxByUser,
        message,
        skipSuccessfulRequests,
        skipFailedRequests,
        enableOwnerBonus,
        trustedIPs: trustedIPs.sort(),
        clavePorCorreo
    });

    // 🔄 VERIFICAR SI YA EXISTE EN CACHE
    if (limitersCache.has(cacheKey)) {
        return limitersCache.get(cacheKey);
    }

    // 🆕 CREAR NUEVA INSTANCIA Y GUARDAR EN CACHE
    const limiter = rateLimit({
        windowMs,
        
        /**
         * 🎯 CLAVE: por usuario si está autenticado, por IP si no.
         *
         * 🔴 AVISO GRANDE — EN CLOUD RUN LA RAMA DE LA IP **NO SEPARA A NADIE** (visto el
         * 2026-09-21). `src/server.js` no hace `app.set('trust proxy', …)`, así que Express
         * **ignora la cabecera `X-Forwarded-For`** y `req.ip` es la dirección del socket, que
         * detrás del proxy de Cloud Run es la MISMA para todas las peticiones del mundo.
         *
         * Comprobado en local con el propio Express: con `X-Forwarded-For: 201.45.7.9` y sin
         * `trust proxy`, `req.ip` devuelve `::ffff:127.0.0.1`.
         *
         * Consecuencia: **todos los cupos "por IP" son en realidad un único cupo global**. El
         * login se llevó la peor parte (ver `createLoginLimiter`), pero afecta a cualquier
         * limitador que actúe sobre peticiones sin autenticar.
         *
         * ⚠️ No se arregla aquí de corrido porque el número de saltos de `trust proxy` **hay que
         * comprobarlo contra producción**, no adivinarlo: según haya o no balanceador delante, la
         * IP del cliente está en una posición distinta de `X-Forwarded-For`, y equivocarse
         * significa o seguir agrupando a todos, o fiarse de una cabecera que el cliente puede
         * falsificar. El plan de verificación está en `PENDING-IMPLEMENTATION.md`.
         */
        keyGenerator: (req) => {
            // 1. Si hay usuario autenticado, usar su ID
            if (req.user && req.user.id) {
                return `user:${req.user.id}`;
            }

            // 2. 🎯 Sin sesión pero con un correo en el cuerpo (login): contar por ESE correo.
            //
            // Es la clave semánticamente correcta para lo que se quiere frenar —alguien adivinando
            // la contraseña de UNA cuenta— y además esquiva el problema de la IP: da igual que
            // `req.ip` no distinga a nadie, porque cada correo lleva su propia cuenta.
            //
            // 🔴 SE NORMALIZA, Y NO ES COSMÉTICO: sin recortar y sin pasar a minúsculas,
            // `JUAN@x.com` y `juan@x.com` serían cubos distintos, y bastaría con ir cambiando
            // mayúsculas para multiplicar el cupo. Es el agujero evidente de esta idea, y se
            // cierra aquí.
            //
            // Requiere que `express.json()` ya haya pasado, y lo hace: va montado a nivel de
            // aplicación en `server.js` antes que cualquier router.
            if (clavePorCorreo) {
                const correo = typeof req.body?.email === 'string'
                    ? req.body.email.trim().toLowerCase()
                    : '';
                if (correo) return `correo:${correo}`;
                // Sin correo utilizable (cuerpo vacío o malformado) se cae a la IP: mejor un cupo
                // compartido que ninguno.
            }

            // 3. Si es endpoint público, usar IP
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
/**
 * 🔐 LOGIN.
 *
 * 🔴 SOLO SE CUENTAN LOS INTENTOS FALLIDOS, y ese es el cambio de fondo del 2026-09-21.
 *
 * Antes se contaba **también el login correcto** (`skipSuccessfulRequests` sin poner = `false`),
 * así que el limitador no racionaba ataques: racionaba **entradas legítimas**. Con 5 por ventana y
 * la sesión durando 16 h, los vendedores entran una vez al día cada uno —más el supervisor— y en
 * la mañana, cuando todos arrancan a la vez, el cupo se agotaba en minutos. Al vendedor le salía
 * "demasiados intentos" **en su primer intento y con la contraseña correcta**.
 *
 * Un limitador de login existe para frenar a quien **adivina contraseñas**. Quien acierta no está
 * adivinando: no hay razón para cobrarle. Por eso ahora el cupo lo gastan únicamente las
 * respuestas de error (el login devuelve **401** cuando las credenciales no valen), y por eso el
 * número pudo subir de 5 a 20 sin aflojar la defensa real — al contrario, 20 fallos seguidos es
 * una señal mucho más limpia que 5 peticiones de cualquier clase.
 *
 * 🎯 Y SE CUENTA POR CUENTA, NO POR IP (`clavePorCorreo`, 2026-09-24). Ése era el problema de
 * fondo: sin `trust proxy`, `req.ip` no distingue a nadie en Cloud Run, así que los vendedores se
 * gastaban el cupo unos a otros. Contando por el correo intentado, **cada cuenta lleva el suyo** y
 * deja de importar que la IP no sirva. Es además lo que de verdad se quiere proteger: que nadie
 * adivine la contraseña de *una* cuenta.
 *
 * ⚠️ La contrapartida, asumida: alguien que conozca el correo de un vendedor puede gastarle los 20
 * fallos y dejarlo fuera **15 minutos**. Se acepta porque antes se podía hacer lo mismo contra
 * TODOS a la vez, que es peor; porque sólo cuentan los fallos; y porque la ventana es corta.
 *
 * ✅ No abre enumeración de usuarios: el 429 llega igual exista o no la cuenta, porque se cuentan
 * los fallos de cualquier correo. El trabajo del 2026-09-15 contra la enumeración sigue intacto.
 *
 * ⚠️ Lo que sigue pendiente es `trust proxy` —el resto de cupos "por IP" continúan sin separar a
 * nadie— y que el `MemoryStore` es por instancia. Ambos en `PENDING-IMPLEMENTATION.md`.
 */
const createLoginLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        windowMs: 15 * 60 * 1000,     // 15 minutos
        maxByIP: 20,                  // 20 intentos FALLIDOS por ventana
        maxByUser: 20,                // (el login no va autenticado; no debería llegar aquí)
        message: "Demasiados intentos de login, intente más tarde",
        skipSuccessfulRequests: true, // 🔴 un login correcto NO gasta cupo
        skipFailedRequests: false,    // los fallidos sí, que son los que importan
        clavePorCorreo: true,         // 🎯 y se cuentan POR CUENTA, no por IP (ver abajo)
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