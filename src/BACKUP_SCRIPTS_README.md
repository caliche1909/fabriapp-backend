# 🔒 Scripts de Backup Seguros

## 📋 **SCRIPTS DISPONIBLES:**

| Script | Función | Cuándo usar |
|--------|---------|-------------|
| `test-sequelize.js` | Backup básico con timestamp | Backup rápido general |
| `backup-before-commit.js` | Backup con info del último commit | Después de hacer commit |
| `backup-with-description.js` | Backup interactivo con descripción | Antes de cambios importantes |
| `restore-backup.js` | Restaurar cualquier backup | Para restaurar BD |

## 🔧 **CONFIGURACIÓN REQUERIDA:**

### **Archivo server/.env:**
```env
DB_USER='postgres'
DB_PASSWORD='tu_password#123'
DB_NAME='fabriapp'  
DB_HOST='127.0.0.1'
DB_DIALECT='postgres'
```

**⚠️ IMPORTANTE:** Usa comillas simples si tu password termina en `#` o caracteres especiales.

## 🚀 **USO:**

### **Para hacer backup:**
```bash
# Backup básico
node test-sequelize.js

# Backup con commit info 
node backup-before-commit.js

# Backup interactivo
node backup-with-description.js
```

### **Para restaurar:**
1. Edita `restore-backup.js`:
   - Cambia `sourceBackupFile` por la ruta de tu backup
   - Cambia `targetDatabase` por el nombre de BD destino
2. Ejecuta: `node restore-backup.js`

## 🔒 **SEGURIDAD:**

### ✅ **SEGURO PARA GITHUB:**
- Los scripts (sin credenciales hardcodeadas)
- Este README
- `.gitignore` configurado

### ❌ **NUNCA SUBIR:**
- Archivo `.env` (contiene credenciales)
- Carpeta `backup_database/` (contiene datos)
- Archivos `*.sql` (contienen BD completa)

## 📁 **ESTRUCTURA GENERADA:**

```
backup_database/
├── backup_2025-07-22_22-09-37/
│   ├── fabriapp_backup_2025-07-22_22-09-37.sql
│   └── README_RESTAURACION.txt
├── dev_backup_2025-07-22_21-30-45_abc123_feat_auth/
│   └── ...
└── dev_backup_2025-07-22_21-35-12_abc123_mi_descripcion/
    └── ...
```

## 🛠️ **SOLUCIÓN DE PROBLEMAS:**

### **"Variables no encontradas":**
- Verifica que el archivo `.env` esté en `server/.env`
- Usa comillas simples para passwords con caracteres especiales

### **"pg_dump no encontrado":**
- El script busca automáticamente en ubicaciones comunes de PostgreSQL
- Verifica que PostgreSQL 17 esté instalado

### **"Archivo de backup no existe":**
- En `restore-backup.js`, actualiza la ruta `sourceBackupFile`
- Verifica que el archivo `.sql` exista

---
**Última actualización:** ${new Date().toLocaleDateString('es-CO')}  
**Estado:** Todos los scripts funcionando correctamente ✅ 