# ==============================================
# ETAPA 1: Base con Node.js (imagen más completa)
# ==============================================
FROM node:20-slim AS base

# Actualizar e instalar herramientas básicas necesarias
RUN apt-get update && apt-get install -y \
    dumb-init \
    python3 \
    make \
    g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no-root para seguridad
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs backend

# Crear directorio de trabajo
WORKDIR /app

# Cambiar propietario del directorio de trabajo
RUN chown -R backend:nodejs /app

# ==============================================
# ETAPA 2: Instalar dependencias
# ==============================================
FROM base AS deps

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && \
    npm cache clean --force

# ==============================================
# ETAPA 3: Imagen final de producción
# ==============================================
FROM node:20-slim AS production

# Instalar solo runtime necesario
RUN apt-get update && apt-get install -y \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no-root para seguridad
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs backend

# Crear directorio de trabajo
WORKDIR /app

# Variables de entorno para producción
ENV NODE_ENV=production
ENV PORT=3000

# Copiar dependencias desde la etapa anterior
COPY --from=deps --chown=backend:nodejs /app/node_modules ./node_modules

# Copiar código fuente
COPY --chown=backend:nodejs ./src ./src
COPY --chown=backend:nodejs package*.json ./

# Cambiar al usuario no-root
USER backend

# Exponer puerto
EXPOSE 3000

# Health check para verificar que la aplicación esté funcionando
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http=require('http'); \
    const options={hostname:'localhost',port:3000,path:'/health',timeout:2000}; \
    const req=http.request(options,(res)=>{process.exit(res.statusCode===200?0:1)}); \
    req.on('error',()=>{process.exit(1)}); \
    req.end();"

# Comando de inicio con dumb-init para manejo correcto de señales
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
