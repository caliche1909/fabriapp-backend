# 🛡️ Sistema de Rate Limiting Inteligente

## Descripción General

Este sistema implementa **rate limiting inteligente** que se adapta automáticamente según el tipo de endpoint y el estado de autenticación del usuario. Protege la API contra abuso, spam y ataques DDoS mientras mantiene una experiencia fluida para usuarios legítimos.

## 🎯 Características Principales

### ✅ **Rate Limiting Dinámico**
- **Endpoints públicos**: Límites estrictos por IP
- **Endpoints protegidos**: Límites generosos por usuario autenticado
- **Límites diferenciados**: Según el tipo de operación (lectura vs escritura)

### ✅ **Identificación Inteligente**
- **Sin autenticación**: Identifica por IP
- **Con autenticación**: Identifica por `req.user.id`
- **Usuarios móviles**: Mantenimiento de límites aunque cambien de IP

### ✅ **Bonus para Propietarios**
- Los usuarios con `userType: 'owner'` reciben límites 50% más generosos
- IPs confiables reciben límites 10x más altos

## 📊 Configuraciones por Tipo de Endpoint

### 🔐 **LOGIN** - `createLoginLimiter`
```javascript
Ventana: 15 minutos
Límite por IP: 5 intentos
Uso: Prevenir ataques de fuerza bruta
```

### 🏢 **REGISTRO DE EMPRESA** - `createCompanyRegistrationLimiter`
```javascript
Ventana: 24 horas
Límite por IP: 2-3 empresas
Uso: Prevenir spam de registros falsos
```

### 👤 **CREACIÓN DE USUARIOS** - `createUserCreationLimiter`
```javascript
Ventana: 1 hora
Límite por IP: 5 usuarios
Límite por usuario: 15 usuarios
Uso: Controlar creación masiva de cuentas
```

### 🏪 **CREACIÓN DE TIENDAS** - `createStoreCreationLimiter`
```javascript
Ventana: 1 hora
Límite por IP: 10 tiendas
Límite por usuario: 25 tiendas
Uso: Permitir operación normal, prevenir abuso
```

### 📦 **CREACIÓN DE SUMINISTROS** - `createSupplyCreationLimiter`
```javascript
Ventana: 1 hora
Límite por IP: 15 suministros
Límite por usuario: 40 suministros
Uso: Balance entre productividad y control
```

### 🖼️ **SUBIDA DE IMÁGENES** - `createImageUploadLimiter`
```javascript
Ventana: 1 hora
Límite por IP: 15-20 imágenes
Límite por usuario: 50-60 imágenes
Uso: Gestionar recursos del servidor
Característica: Solo cuenta uploads fallidos
```

### 🔄 **OPERACIONES GENERALES** - `createGeneralLimiter`
```javascript
Ventana: 15 minutos
Límite por IP: 50 peticiones
Límite por usuario: 200 peticiones
Uso: Actualizaciones, eliminaciones, operaciones mixtas
```

### 📱 **OPERACIONES MÓVILES** - `createMobileLimiter`
```javascript
Ventana: 15 minutos
Límite por IP: 30 peticiones
Límite por usuario: 300 peticiones
Uso: Vendedores móviles con conectividad variable
```

### 🔍 **CONSULTAS** - `createQueryLimiter`
```javascript
Ventana: 15 minutos
Límite por IP: 100 peticiones
Límite por usuario: 500 peticiones
Uso: Operaciones de lectura, reportes, consultas
Característica: Solo cuenta consultas fallidas
```

## 🚀 Implementación por Ruta

### **Rutas de Usuarios** (`/api/users`)
```javascript
✅ Login: loginLimiter (MUY ESTRICTO - 5/15min)
✅ Crear usuario: userCreationLimiter personalizado (MODERADO - 20/hora)
✅ Crear usuario existente: userCreationLimiter personalizado (MODERADO - 20/hora)
✅ Actualizar datos: createGeneralLimiter personalizado (GENEROSO - 100/15min)
✅ Cambiar contraseña: createGeneralLimiter personalizado (RESTRICTIVO - 25/15min)
✅ Consultar vendedores: createQueryLimiter personalizado (MODERADO - 180/15min)
```

### **Registro de Empresas** (`/api/register-company-and-user`)
```javascript
✅ Setup inicial: companyRegistrationLimiter (MUY ESTRICTO)
✅ Registro adicional: generalLimiter (NORMAL)
```

### **Tiendas** (`/api/stores`)
```javascript
✅ Crear tienda: storeCreationLimiter (MODERADO)
✅ Consultas móviles: mobileLimiter (GENEROSO)
✅ Otras consultas: queryLimiter (GENEROSO)
✅ Actualizaciones: generalLimiter (NORMAL)
```

### **Subida de Imágenes** (`/api/upload_images`)
```javascript
✅ Todas las subidas: imageUploadLimiter (MODERADO)
✅ Eliminaciones: generalLimiter (NORMAL)
```

### **Inventario** (`/api/inventory_supplies`)
```javascript
✅ Crear suministro: supplyCreationLimiter (MODERADO)
✅ Consultas: queryLimiter (GENEROSO)
✅ Actualizaciones: generalLimiter (NORMAL)
```

### **Rutas** (`/api/routes`)
```javascript
✅ Lista rutas: listRoutesByCompanyLimiter (MODERADO - se guarda en Redux)
✅ Crear ruta: createRouteLimiter (RESTRICTIVO - operación de configuración)
✅ Actualizar ruta: updateRouteLimiter (MODERADO - ajustes de rutas)
✅ Eliminar ruta: deleteRouteLimiter (MUY RESTRICTIVO - operación crítica)
```

### **Tipos de Tienda** (`/api/store_types`)
```javascript
✅ Lista tipos: storeTypesCatalogLimiter (GENEROSO - catálogo Redux)
```

### **Proveedores** (`/api/supplier_companies`)
```javascript
✅ Crear proveedor: createStoreCreationLimiter personalizado (RESTRICTIVO - 30/hora)
✅ Listar proveedores: createQueryLimiter personalizado (MODERADO - 100/15min)
```

### **Stock de Insumos** (`/api/supplies_stock`)
```javascript
✅ Registrar movimiento: createGeneralLimiter personalizado (OPERATIVO - 80/15min)
✅ Ver movimientos: createQueryLimiter personalizado (AUDITORÍA - 120/15min)
```

### **Subida de Imágenes** (`/api/upload_images`)
```javascript
✅ Subir imagen tienda: createImageUploadLimiter personalizado (MODERADO - 60/hora)
✅ Subir imagen perfil: createImageUploadLimiter personalizado (RESTRICTIVO - 25/hora)  
✅ Eliminar imagen: createGeneralLimiter personalizado (GENEROSO - 100/15min)
```

**Características Especiales de Imágenes:**
- `skipSuccessfulRequests: true` - Solo cuenta uploads fallidos (no penalizar éxito)
- Límites por hora (no por 15min) - Operaciones menos frecuentes
- Diferenciación por tipo: tiendas vs perfil (uso diferente)
- OWNERS bonus aplicado (gestores necesitan más flexibilidad)

## 🔧 Personalización de Limitadores por Ruta

### **Patrón Recomendado (Evitar Proliferación)**
En lugar de crear nuevos métodos en el middleware, personaliza los existentes:

```javascript
// ✅ CORRECTO: Personalizar en la ruta
const customLimiter = createGeneralLimiter({
    maxByUser: 50,              // Override específico
    message: "Mensaje personalizado",
    enableOwnerBonus: false     // Deshabilitar bonus
});

// ❌ INCORRECTO: Crear función específica en middleware
const createVerySpecificLimiter = () => { ... }
```

### **Limitadores Base Disponibles**
- `createLoginLimiter` - Para autenticación
- `createGeneralLimiter` - Para operaciones comunes
- `createQueryLimiter` - Para consultas/lecturas
- `createStoreCreationLimiter` - Para creación de entidades
- `createSupplyCreationLimiter` - Para creación de inventario
- Y otros limitadores base existentes

### **Consideraciones Especiales**
- **Operaciones operativas críticas** (ej. stock, ventas): Límites más generosos
- **Operaciones de configuración** (ej. crear entidades): Límites más restrictivos  
- **Consultas de auditoría** (ej. movimientos, reportes): Límites moderados
- **Catálogos con Redux** (ej. roles, tipos): Límites generosos con cacheo
- **Subida de imágenes**: Límites moderados (consume recursos del servidor)
- **Eliminación de recursos**: Límites más generosos (operación menos costosa)
- **Operaciones sensibles** (ej. cambio contraseña): Límites más restrictivos + auditoría
- **Endpoints no utilizados**: Comentados para futuro uso

### **Gestión de Endpoints No Utilizados**
```javascript
// ✅ CORRECTO: Comentar endpoints no activos
// router.post('/logout', verifyToken, generalLimiter, userController.logout);

// ❌ INCORRECTO: Dejar endpoints activos sin uso
router.post('/logout', verifyToken, generalLimiter, userController.logout);
```

## ⚙️ Configuración de IPs Confiables

Para agregar IPs de tu equipo administrativo, edita cada archivo de rutas:

```javascript
const limiter = createSomeLimiter({
    trustedIPs: [
        '127.0.0.1',        // Localhost
        '::1',              // IPv6 localhost
        '192.168.1.100',    // IP de tu oficina
        '10.0.0.50'         // IP del equipo de desarrollo
    ]
});
```

## 📊 Monitoreo y Debugging

### **Logs Automáticos**
Cuando se excede un límite, se genera un log como:
```
🚫 Rate limit exceeded - Usuario: juan@empresa.com (ID: 123) - Endpoint: POST /api/users/create-user
```

### **Respuesta de Error**
```json
{
    "success": false,
    "status": 429,
    "message": "Límite de creación de usuarios alcanzado",
    "details": {
        "identifier": "juan@empresa.com",
        "retryAfter": "60 minutos",
        "endpoint": "POST /api/users/create-user"
    }
}
```

## 🔧 Ajustes y Personalización

### **Modificar Límites Globalmente**
Edita `smartRateLimit.middleware.js`:
```javascript
const createUserCreationLimiter = (customOptions = {}) => {
    return createSmartRateLimit({
        maxByUser: 20,  // Cambiar de 15 a 20
        ...customOptions
    });
};
```

### **Ajustar Límites por Ruta**
En el archivo de ruta específico:
```javascript
const customLimiter = createUserCreationLimiter({
    maxByUser: 25,      // Override específico
    windowMs: 2 * 60 * 60 * 1000  // 2 horas en lugar de 1
});
```

### **Deshabilitar Rate Limiting (Desarrollo)**
```javascript
// Comentar o remover el middleware
// router.post('/create-user', limiter, controller.createUser);
router.post('/create-user', verifyToken, controller.createUser);
```

## 📈 Consumo de Recursos

### **Memoria**
- ~100 bytes por IP/usuario activo
- 1000 usuarios simultáneos = ~100KB RAM
- Limpieza automática después de la ventana de tiempo

### **CPU**
- ~0.1ms por verificación
- Impacto insignificante comparado con validación JWT

### **Escalabilidad**
- Almacenamiento en memoria (por defecto)
- Para múltiples servidores: considerar Redis store

## 🚨 Casos de Emergencia

### **Deshabilitar Temporalmente**
Comentar las importaciones en los archivos de rutas:
```javascript
// const { createSomeLimiter } = require('../middlewares/smartRateLimit.middleware');
```

### **Límites de Emergencia (Muy Restrictivos)**
```javascript
const emergencyLimiter = createSmartRateLimit({
    windowMs: 60 * 60 * 1000,  // 1 hora
    maxByIP: 1,                // 1 por hora por IP
    maxByUser: 2,              // 2 por hora por usuario
    message: "Sistema en mantenimiento. Límites temporales activos."
});
```

## 🎯 Métricas de Éxito

### **Reducción de Abuso**
- Menos registros falsos de empresas
- Menor carga de servidor por peticiones masivas
- Protección efectiva contra bots

### **Experiencia de Usuario**
- Usuarios legítimos NO deben verse afectados
- Vendedores móviles operan normalmente
- Operaciones frecuentes permitidas

### **Indicadores a Monitorear**
- Frecuencia de límites alcanzados
- Quejas de usuarios sobre límites
- Rendimiento del servidor bajo carga

---

**Implementado**: Rate limiting inteligente con 9 configuraciones diferentes para proteger todos los endpoints críticos del sistema.

**Resultado**: API más segura, menor abuso, mejor rendimiento, experiencia de usuario preservada. 