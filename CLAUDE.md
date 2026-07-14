# CLAUDE.md — FabriApp Backend (server)

Este archivo orienta a Claude (y a cualquier desarrollador) sobre qué es este repositorio y cómo trabajar en él.

## Qué es FabriApp

FabriApp es un **sistema integral de gestión para fábricas y empresas de producción y distribución** (orientado a negocios tipo panadería/alimentos, distribuidoras y similares). Cubre inventario de insumos y productos, recetas y costos, producción, ventas y **rutas de reparto con seguimiento GPS en tiempo real**.

El sistema es **multi-empresa (multi-tenant)**: un usuario puede pertenecer a varias compañías, con roles y permisos por compañía, y toda la información está aislada por compañía.

Este repo es el **backend**: la API REST y el servidor de WebSockets. Forma parte de un monorepo lógico con tres piezas:

- `server/` → **este repo**: API Node/Express + PostgreSQL (Sequelize) + Socket.IO.
- `client/` → frontend React + TypeScript (dashboard de la aplicación).
- `fabriapp-website/` → sitio web público / landing (fabriapp.com).

Repositorio remoto: `https://github.com/caliche1909/fabriapp-backend.git`

## Stack técnico

- **Node.js (>=18)** + **Express 4** — JavaScript (CommonJS, no TypeScript).
- **PostgreSQL** vía **Sequelize 6** (ORM) + `pg`. Migraciones con `sequelize-cli`.
- **Socket.IO** para tracking GPS en tiempo real.
- **JWT** (`jsonwebtoken`) + **bcrypt** para autenticación y hashing de contraseñas.
- **Cloudinary** + **Multer** + **Sharp**/**imagemin** para subida y optimización de imágenes.
- **Nodemailer** para emails (reset de contraseña, verificaciones).
- **Google APIs** (`googleapis`) para geocodificación / integraciones de Maps.
- **@google-cloud/secret-manager** para secretos en producción.
- **express-rate-limit** para limitación de peticiones.

## Estructura del proyecto (`src/`)

Arquitectura clásica en capas: **routes → controllers → models (Sequelize)**.

- `server.js` — Punto de entrada. Configura Express, CORS (con allowlist de orígenes), monta todas las rutas, expone `/health` e inicializa los sockets (`initSockets`).
- `routes/` — Define los endpoints y los conecta a controladores. Una ruta por dominio: auth, users, measurementUnits, supplierCompanies, inventorySupplies (+ balance, + stock), routes (+ route_types), storeTypes, stores, uploadImages, registerCompanyAndUser, company, userGeolocation, roles, modules, geocoding, storeNoSaleReports, noSaleCategories, paymentMethods, sales.
- `controllers/` — Lógica de negocio por dominio (mismos dominios que las rutas). `index.js` reexporta.
- `models/` — Modelos Sequelize generados/definidos por tabla. `index.js` e `init-models.js` registran asociaciones. Entidades principales:
  - **Empresa/usuarios**: `companies`, `users`, `user_companies` (relación N:M usuario↔empresa), `roles`, `permissions`, `role_permissions`, `modules`, `submodules`, `password_resets`.
  - **Inventario**: `inventory_supplies`, `inventory_supplies_balance`, `supplies_stock`, `supplier_companies`, `supplier_verifications`, `measurement_units`, `products`, `recipes`, `recipe_items`.
  - **Rutas/reparto**: `routes`, `route_types`, `stores`, `store_types`, `store_images`, `store_visits`, `work_areas`, `user_current_position` (posición GPS actual).
  - **Ventas**: `sales`, `sale_items`, `payment_methods`, `store_no_sale_reports`, `no_sale_categories`, `no_sale_reasons`.
- `middlewares/` — `jwt.middleware.js` (auth), `smartRateLimit.middleware.js` (rate limiting; ver `README_RateLimiting.md`), `uploadImages.middleware.js`.
- `sockets/` — Servidor WebSocket. `index.js` inicializa Socket.IO; `auth.js` autentica la conexión por JWT; `rateLimit.js`; `handlers/userPosition.handler.js` procesa la posición de los repartidores.
- `config/` — `config.json` (Sequelize/DB), `cloudenary.config.js`, `send-emails.json`.
- `utils/` — Utilidades, incluyendo `email/` (plantillas/envío).
- `migrations/` (en la raíz del repo, junto a `.sequelizerc`) — Migraciones de base de datos.

## Conceptos de dominio importantes

- **Multi-tenant por compañía**: casi toda consulta se filtra por la compañía del usuario autenticado. La relación usuario↔empresa está en `user_companies`, con rol y permisos asociados.
- **Roles y permisos**: el acceso se controla con `roles`, `permissions`, `role_permissions` y la estructura de `modules`/`submodules`.
- **Tracking en tiempo real con salas por compañía**: cada compañía tiene una sala Socket.IO `company_{id}`. La posición de un repartidor solo se emite a la sala de su compañía, garantizando aislamiento de datos. Lógica clave en `sockets/handlers/userPosition.handler.js` y `models/user_current_position`. **Lee `WEBSOCKETS_EXPLICACION.md`** (raíz del monorepo) para la explicación completa.
- **Registro combinado**: `registerCompanyAndUser` crea empresa + usuario administrador en un solo flujo.
- **Imágenes**: se suben optimizadas a Cloudinary (tiendas, productos, etc.).

## Scripts de mantenimiento y backups (en `src/`)

Dentro de `src/` conviven, junto al código de la aplicación, varios **scripts sueltos de mantenimiento** que **NO forman parte del servidor** y no se ejecutan al levantar la API. Son herramientas de operación que se corren a mano con `node`. No los importes desde el código de la app ni los modifiques como si fueran parte del runtime.

- `test-sequelize.js` — Backup **básico** de la base de datos con timestamp (pese al nombre, no es un test). Uso: `node test-sequelize.js`.
- `backup-before-commit.js` — Backup que además guarda la **info del último commit** de Git; pensado para correr después de un commit. Uso: `node backup-before-commit.js`.
- `backup-with-description.js` — Backup **interactivo**: pide una descripción y la incluye en el nombre. Úsalo antes de cambios importantes. Uso: `node backup-with-description.js`.
- `restore-backup.js` — **Restaura** un backup a una BD destino. Antes de ejecutarlo hay que editar dentro del archivo `sourceBackupFile` (ruta del `.sql`) y `targetDatabase`. Uso: `node restore-backup.js`.
- `diagnostico.js` — Script de **diagnóstico de autenticación con Google** (Gmail API / envío de correos). No toca la base de datos; sirve para verificar credenciales/`GOOGLE_APPLICATION_CREDENTIALS`.
- `BACKUP_SCRIPTS_README.md` — Documentación detallada de los scripts de backup (configuración `.env`, uso, restauración y solución de problemas). **Consúltalo antes de usar los scripts de backup.**

Notas importantes:
- Los backups requieren `pg_dump` (PostgreSQL 17) instalado y las variables `DB_*` en `server/.env`.
- Generan la carpeta `backup_database/` con archivos `.sql`. **Nunca subas a Git** el `.env`, la carpeta `backup_database/` ni archivos `*.sql` (contienen la base de datos completa).

## Comandos

```bash
npm run dev            # Desarrollo con nodemon (src/server.js)
npm start              # Producción (node src/server.js)
npm run health         # Comprueba GET /health

# Migraciones (sequelize-cli, configurado vía .sequelizerc)
npx sequelize-cli db:migrate
npx sequelize-cli db:migrate:undo
```

## Variables de entorno

Ver `.env.example`. Claves principales:

- **Servidor**: `PORT` (3000), `NODE_ENV`.
- **Base de datos**: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- **Auth**: `JWT_SECRET` (mínimo 32 caracteres en producción).
- **Email (SMTP)**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`.
- **Frontend/CORS**: `FRONTEND_URL`, `FRONTEND_URL_PRODUCTION`.
- Cloudinary y Google APIs según corresponda.

CORS tiene una allowlist explícita en `server.js` (localhost:5173/5174 y dominios `fabriapp.com`), más las URLs de las variables de entorno.

## Despliegue

Contenedor **Docker** (`Dockerfile`) desplegado en **Google Cloud Run**, con **Cloud SQL (PostgreSQL)** como base de datos y **Secret Manager** para secretos. Producción tras el dominio `fabriapp.com`. Ver `DOCKER_GUIDE.md` (local) e `INFRASTRUCTURE.md` (raíz del monorepo, incluye costos y arquitectura GCP).

## Convenciones y notas para trabajar aquí

- Código y comentarios en **español**; mantén ese idioma.
- Es **CommonJS** (`require`/`module.exports`), no ESM ni TypeScript.
- Respeta el patrón **routes → controllers → models**: las rutas no deben contener lógica de negocio.
- Toda consulta sensible debe filtrarse por la compañía del usuario autenticado para no romper el aislamiento multi-tenant.
- Las rutas protegidas pasan por `jwt.middleware.js`; aplica `smartRateLimit` donde corresponda.
- Cambios de esquema de BD se hacen con **migraciones de Sequelize**, no modificando modelos a mano sin migración.
- Los nombres de tablas/modelos están en **snake_case y plural** (`inventory_supplies`, `store_no_sale_reports`).
