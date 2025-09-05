# Guía Completa: Dockerización de Backend Node.js

## 📋 Introducción

Esta guía documenta el proceso completo para dockerizar una aplicación Node.js backend, desde la preparación del código hasta la creación y gestión de contenedores Docker. Siguiendo estos pasos, podrás crear una imagen Docker optimizada y lista para producción.

## 🎯 Objetivos

- Preparar el código backend para Docker
- Crear una imagen Docker optimizada
- Gestionar contenedores de manera eficiente
- Documentar comandos esenciales de Docker

---

## 🛠️ FASE 1: Preparación del Código

### PASO 1: Limpiar Console.logs
**¿Por qué?** Los console.logs en producción consumen recursos y pueden exponer información sensible.

**Acción:** Eliminar todos los `console.log()` del código fuente.

```bash
# Buscar console.logs restantes
grep -r "console.log" src/
```

### PASO 2: Crear Variables de Entorno (.env.example)
**¿Por qué?** Documenta las variables necesarias para que otros desarrolladores sepan qué configurar.

**Acción:** Crear archivo `.env.example` con todas las variables requeridas:

```env
# Configuración del Servidor
PORT=3000
NODE_ENV=production

# Base de Datos
DB_HOST=localhost
DB_PORT=5432
DB_NAME=database_name
DB_USER=database_user
DB_PASSWORD=database_password

# Autenticación
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# APIs Externas
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# CORS
FRONTEND_URL=http://localhost:5173
```

### PASO 3: Optimizar package.json
**¿Por qué?** Agregar scripts Docker y metadata profesional mejora la gestión del proyecto.

**Acción:** Actualizar `package.json` con:

```json
{
  "name": "siloe-backend",
  "version": "1.0.0",
  "description": "Sistema de gestión empresarial - Backend API",
  "author": "Tu Nombre <email@example.com>",
  "scripts": {
    "docker:build": "docker build -t siloe-backend .",
    "docker:run": "docker run -d -p 3000:3000 --name siloe-backend-app siloe-backend",
    "docker:dev": "docker run -it -p 3000:3000 -v $(pwd):/app siloe-backend npm run dev"
  },
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

### PASO 4: Crear .dockerignore
**¿Por qué?** Optimiza el contexto de build excluyendo archivos innecesarios, reduciendo el tiempo de construcción y el tamaño de la imagen.

**Acción:** Crear archivo `.dockerignore`:

```dockerignore
# Dependencias
node_modules
npm-debug.log*

# Archivos de entorno
.env
.env.local
.env.*.local

# Logs
logs
*.log

# Git
.git
.gitignore

# Docker
Dockerfile
.dockerignore
docker-compose*.yml

# Documentación
README.md
DOCKER_GUIDE.md
docs/

# Archivos temporales
.tmp
temp/
```

---

## 🐳 FASE 2: Configuración Docker

### PASO 5: Crear Dockerfile
**¿Por qué?** Define cómo construir la imagen Docker con las mejores prácticas de seguridad y rendimiento.

**Acción:** Crear `Dockerfile` optimizado:

```dockerfile
# Imagen base ligera de Node.js
FROM node:20-slim

# Crear usuario no-root para seguridad
RUN groupadd -g 1001 appgroup && \
    useradd -r -u 1001 -g appgroup appuser

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && \
    npm cache clean --force

# Copiar código fuente
COPY . .

# Cambiar ownership al usuario no-root
RUN chown -R appuser:appgroup /app

# Cambiar a usuario no-root
USER appuser

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Comando de inicio
CMD ["npm", "start"]
```

### PASO 6: Endpoint de Health Check
**¿Por qué?** Permite a Docker verificar que la aplicación está funcionando correctamente.

**Acción:** Agregar endpoint en tu aplicación:

```javascript
// En tu servidor principal (server.js o app.js)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

---

## 🚀 FASE 3: Construcción y Gestión

### Construcción de la Imagen

```bash
# Construir la imagen
docker build -t siloe-backend .

# Construir con tag específico
docker build -t siloe-backend:v1.0.0 .

# Construcción sin usar caché
docker build --no-cache -t siloe-backend .
```

---

## 📖 Comandos Docker Esenciales

### 🏗️ Gestión de Imágenes

| Comando | Descripción |
|---------|-------------|
| `docker build -t nombre-imagen .` | Construye una imagen Docker desde el Dockerfile en el directorio actual |
| `docker images` | Lista todas las imágenes Docker disponibles en el sistema |
| `docker rmi imagen-id` | Elimina una imagen específica por su ID |
| `docker rmi nombre-imagen` | Elimina una imagen específica por su nombre |
| `docker image prune` | Elimina todas las imágenes no utilizadas (dangling) |
| `docker image prune -a` | Elimina todas las imágenes no utilizadas por contenedores |

### 🚀 Gestión de Contenedores

| Comando | Descripción |
|---------|-------------|
| `docker run -d -p 3000:3000 --name mi-app imagen` | Crea y ejecuta un contenedor en background con mapeo de puertos |
| `docker run -it -p 3000:3000 imagen` | Ejecuta un contenedor en modo interactivo |
| `docker ps` | Lista contenedores que están corriendo actualmente |
| `docker ps -a` | Lista todos los contenedores (corriendo y detenidos) |
| `docker stop contenedor-id` | Detiene un contenedor específico |
| `docker start contenedor-id` | Inicia un contenedor detenido |
| `docker restart contenedor-id` | Reinicia un contenedor |
| `docker rm contenedor-id` | Elimina un contenedor detenido |
| `docker rm -f contenedor-id` | Fuerza la eliminación de un contenedor (incluso si está corriendo) |

### 🔍 Monitoreo y Debugging

| Comando | Descripción |
|---------|-------------|
| `docker logs contenedor-id` | Muestra los logs de un contenedor |
| `docker logs -f contenedor-id` | Sigue los logs en tiempo real |
| `docker exec -it contenedor-id bash` | Abre una terminal interactiva dentro del contenedor |
| `docker inspect contenedor-id` | Muestra información detallada del contenedor |
| `docker stats` | Muestra estadísticas de uso de recursos en tiempo real |
| `docker port contenedor-id` | Muestra los mapeos de puertos del contenedor |

### 🧹 Limpieza del Sistema

| Comando | Descripción |
|---------|-------------|
| `docker system prune` | Elimina contenedores detenidos, redes no usadas, imágenes dangling y caché |
| `docker system prune -a` | Limpieza completa: incluye todas las imágenes no utilizadas |
| `docker container prune` | Elimina todos los contenedores detenidos |
| `docker volume prune` | Elimina todos los volúmenes no utilizados |
| `docker network prune` | Elimina todas las redes no utilizadas |

---

## 🎯 Ejemplos Prácticos Completos

### Flujo Completo de Desarrollo

```bash
# 1. Construir la imagen
docker build -t siloe-backend .

# 2. Ejecutar contenedor
docker run -d -p 3000:3000 --name siloe-app siloe-backend

# 3. Verificar que está corriendo
docker ps

# 4. Ver logs
docker logs siloe-app

# 5. Probar la aplicación
curl http://localhost:3000/health

# 6. Detener cuando termines
docker stop siloe-app

# 7. Eliminar contenedor
docker rm siloe-app
```

### Desarrollo con Volúmenes (Hot Reload)

```bash
# Ejecutar en modo desarrollo con volumen
docker run -it -p 3000:3000 \
  -v $(pwd):/app \
  -v /app/node_modules \
  --name siloe-dev \
  siloe-backend npm run dev
```

### Limpieza Completa

```bash
# Detener todos los contenedores
docker stop $(docker ps -q)

# Eliminar todos los contenedores
docker rm $(docker ps -aq)

# Limpieza completa del sistema
docker system prune -a --volumes
```

---

## ✅ Verificaciones Finales

### Checklist de Imagen Exitosa

- [ ] ✅ Imagen construida sin errores
- [ ] ✅ Tamaño de imagen optimizado (< 500MB para Node.js)
- [ ] ✅ Contenedor inicia correctamente
- [ ] ✅ Health check responde exitosamente
- [ ] ✅ Aplicación accesible en puerto configurado
- [ ] ✅ Logs muestran funcionamiento normal
- [ ] ✅ No hay console.logs en producción

### Troubleshooting Común

| Problema | Solución |
|----------|----------|
| "Cannot find module" | Verificar que `npm ci` se ejecutó correctamente |
| "Port already in use" | Cambiar puerto: `-p 3001:3000` |
| "Permission denied" | Verificar usuario no-root en Dockerfile |
| "Health check failing" | Verificar endpoint `/health` implementado |
| "Build context too large" | Optimizar `.dockerignore` |

---

## 🎓 Conclusión

Esta guía proporciona una base sólida para dockerizar aplicaciones Node.js backend. La dockerización mejora la portabilidad, facilita el deployment y asegura consistencia entre entornos de desarrollo, staging y producción.

**Puntos clave:**
- Preparación adecuada del código es fundamental
- Security best practices con usuarios no-root
- Optimización del contexto de build
- Health checks para monitoreo
- Gestión eficiente de contenedores

Para proyectos específicos, adapta los comandos y configuraciones según tus necesidades particulares.
