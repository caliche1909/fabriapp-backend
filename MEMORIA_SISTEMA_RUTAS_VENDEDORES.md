# 📋 MEMORIA: SISTEMA DE GESTIÓN DE RUTAS Y VENDEDORES

## 🎯 CONTEXTO DEL PROYECTO
**Aplicación:** Sistema de gestión para fábricas de panadería y pastelería
**Objetivo:** Implementar sistema completo de rutas, tiendas y vendedores con geolocalización

## 🏗️ ARQUITECTURA PROPUESTA

### 1. MODELO DE DATOS MEJORADO

#### **RUTAS (`routes`)**
```sql
-- AGREGAR CAMPOS FALTANTES:
ALTER TABLE routes ADD COLUMN company_id UUID NOT NULL REFERENCES companies(id);
ALTER TABLE routes ALTER COLUMN user_id TYPE UUID; -- Cambiar de INTEGER a UUID
```

**Campos finales:**
- `id` (INTEGER, PK)
- `name` (VARCHAR)
- `company_id` (UUID, FK) **🆕 NUEVO**
- `user_id` (UUID, FK) - Vendedor asignado
- `working_days` (ARRAY)
- `created_at` (TIMESTAMP)

#### **TIENDAS (`stores`)**
```sql
-- AGREGAR CAMPO FALTANTE:
ALTER TABLE stores ADD COLUMN company_id UUID NOT NULL REFERENCES companies(id);
```

**Campos finales:**
- `id` (INTEGER, PK)
- `name`, `address`, `phone`, etc.
- `company_id` (UUID, FK) **🆕 NUEVO**
- `route_id` (INTEGER, FK) - Puede ser NULL (tiendas huérfanas)
- `manager_id` (UUID, FK)
- `store_type_id` (INTEGER, FK)
- Campos de geolocalización: `latitude`, `longitude`

#### **USUARIOS VENDEDORES (`users` extendido)**
```sql
-- AGREGAR CAMPOS PARA VENDEDORES:
ALTER TABLE users ADD COLUMN current_latitude DECIMAL(23,20);
ALTER TABLE users ADD COLUMN current_longitude DECIMAL(24,20);
ALTER TABLE users ADD COLUMN last_location_update TIMESTAMP;
ALTER TABLE users ADD COLUMN route_status VARCHAR(20) DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN is_seller BOOLEAN DEFAULT FALSE;
```

**Nuevos campos:**
- `current_latitude` (DECIMAL) - Ubicación actual
- `current_longitude` (DECIMAL) - Ubicación actual
- `last_location_update` (TIMESTAMP) - Última actualización GPS
- `route_status` (ENUM) - Estados: 'inactive', 'active', 'on_route', 'paused'
- `is_seller` (BOOLEAN) - Flag para identificar vendedores rápidamente

### 2. RELACIONES FINALES

```
companies (1) ←→ (N) routes
companies (1) ←→ (N) stores
routes (1) ←→ (N) stores [puede ser NULL - tiendas huérfanas]
routes (1) ←→ (1) users [seller]
stores (1) ←→ (1) users [manager]
stores (1) ←→ (1) store_types
stores (1) ←→ (N) store_images
```

### 3. REGLAS DE NEGOCIO

#### **OWNERSHIP POR COMPAÑÍA:**
- ✅ Una compañía puede tener múltiples rutas
- ✅ Una compañía puede tener múltiples tiendas
- ✅ Las tiendas pueden estar asignadas a rutas o ser huérfanas
- ✅ Solo usuarios con permisos pueden ver/editar rutas/tiendas de su compañía

#### **GESTIÓN DE VENDEDORES:**
- ✅ Un vendedor (`user` con `is_seller = true`) puede tener múltiples rutas
- ✅ Una ruta solo puede tener un vendedor activo
- ✅ Los vendedores reportan ubicación en tiempo real
- ✅ Estados de ruta: inactive, active, on_route, paused

#### **TIENDAS HUÉRFANAS:**
- ✅ Cuando se elimina una ruta, las tiendas quedan con `route_id = NULL`
- ✅ Las tiendas huérfanas pueden ser reasignadas a otras rutas
- ✅ Siempre mantienen su `company_id` para ownership

## 🚀 FLUJO DE IMPLEMENTACIÓN

### FASE 1: MIGRACIÓN DE BASE DE DATOS
1. Agregar `company_id` a `routes` y `stores`
2. Cambiar `routes.user_id` de INTEGER a UUID
3. Agregar campos de geolocalización a `users`
4. Crear índices para optimización

### FASE 2: ACTUALIZAR MODELOS SEQUELIZE
1. Modificar `routes.js` - agregar relación con `companies`
2. Modificar `stores.js` - agregar relación con `companies`
3. Modificar `users.js` - agregar campos de vendedor
4. Actualizar `init-models.js` con nuevas relaciones

### FASE 3: CONTROLADORES Y LÓGICA
1. Modificar controladores para filtrar por `company_id`
2. Implementar endpoints de geolocalización para vendedores
3. Crear lógica de asignación/reasignación de tiendas
4. Implementar sistema de estados de ruta

### FASE 4: FUNCIONALIDADES AVANZADAS
1. WebSocket para tracking en tiempo real
2. Notificaciones push para vendedores
3. Reportes de rutas y performance
4. Optimización de rutas por geolocalización

## 🔧 ENDPOINTS PRINCIPALES

### **RUTAS**
- `GET /api/routes/company/:company_id` - Rutas de una compañía
- `POST /api/routes/create` - Crear ruta (con company_id)
- `PUT /api/routes/:id/assign-seller` - Asignar vendedor
- `GET /api/routes/:id/stores` - Tiendas de una ruta

### **TIENDAS**
- `GET /api/stores/company/:company_id` - Tiendas de una compañía
- `GET /api/stores/orphan/:company_id` - Tiendas huérfanas
- `PUT /api/stores/:id/assign-route` - Asignar a ruta
- `PUT /api/stores/:id/remove-route` - Convertir en huérfana

### **VENDEDORES**
- `GET /api/sellers/company/:company_id` - Vendedores de una compañía
- `POST /api/sellers/:id/location` - Actualizar ubicación
- `PUT /api/sellers/:id/route-status` - Cambiar estado de ruta
- `GET /api/sellers/:id/current-route` - Ruta actual del vendedor

## 🎯 BENEFICIOS DE ESTA ARQUITECTURA

### **ESCALABILIDAD:**
- ✅ Soporte para múltiples compañías
- ✅ Crecimiento ilimitado de rutas/tiendas
- ✅ Geolocalización en tiempo real

### **SEGURIDAD:**
- ✅ Aislamiento de datos por compañía
- ✅ Control de permisos granular
- ✅ Trazabilidad completa

### **FUNCIONALIDAD:**
- ✅ Gestión flexible de rutas
- ✅ Tiendas huérfanas reasignables
- ✅ Tracking de vendedores
- ✅ Reportes y analytics

## 📊 MÉTRICAS Y MONITOREO

### **KPIs PRINCIPALES:**
- Número de tiendas por ruta
- Tiempo promedio de visita por tienda
- Distancia recorrida por vendedor
- Tiendas huérfanas por compañía
- Performance de vendedores por ruta

### **ALERTAS:**
- Vendedor sin reporte de ubicación > 30 min
- Ruta con más de X tiendas huérfanas
- Vendedor fuera de ruta asignada
- Tienda sin visita > X días

---

**Estado:** ANÁLISIS COMPLETO ✅
**Próximo paso:** Implementar FASE 1 - Migración de Base de Datos
**Prioridad:** ALTA - Base para todo el sistema de ventas 