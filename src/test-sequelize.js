const db = require('./models');

async function testPermissions() {
    try {
        // Consultar todos los permisos organizados por módulo y submódulo
        const modules = await db.modules.findAll({
            include: [{
                model: db.submodules,
                as: 'submodules',
                include: [{
                    model: db.permissions,
                    as: 'permissions'
                }]
            }],
            order: [
                ['name', 'ASC'],
                [{ model: db.submodules, as: 'submodules' }, 'name', 'ASC'],
                [{ model: db.submodules, as: 'submodules' }, { model: db.permissions, as: 'permissions' }, 'name', 'ASC']
            ]
        });

        console.log('\n=== PERMISOS DEL SISTEMA ===\n');
        
        // Crear tabla para mostrar los permisos
        console.log('┌─────────────────┬─────────────────┬──────────────────┬────────────────────────────────┐');
        console.log('│     MÓDULO      │    SUBMÓDULO    │     PERMISO      │         DESCRIPCIÓN           │');
        console.log('├─────────────────┼─────────────────┼──────────────────┼────────────────────────────────┤');

        // Variables para contar
        let totalModules = 0;
        let totalSubmodules = 0;
        let totalPermissions = 0;

        // Iterar sobre los módulos
        for (const module of modules) {
            totalModules++;
            
            if (module.submodules && module.submodules.length > 0) {
                for (const submodule of module.submodules) {
                    totalSubmodules++;
                    
                    if (submodule.permissions && submodule.permissions.length > 0) {
                        for (const permission of submodule.permissions) {
                            totalPermissions++;
                            
                            // Formatear cada columna para que tenga un ancho fijo
                            const moduleName = module.name.padEnd(15).slice(0, 15);
                            const submoduleName = submodule.name.padEnd(15).slice(0, 15);
                            const permissionName = permission.name.padEnd(16).slice(0, 16);
                            const description = (permission.description || 'Sin descripción').padEnd(30).slice(0, 30);

                            console.log(`│ ${moduleName} │ ${submoduleName} │ ${permissionName} │ ${description} │`);
                        }
                    } else {
                        // Submódulo sin permisos
                        const moduleName = module.name.padEnd(15).slice(0, 15);
                        const submoduleName = submodule.name.padEnd(15).slice(0, 15);
                        console.log(`│ ${moduleName} │ ${submoduleName} │ Sin permisos    │ ----------------------------- │`);
                    }
                }
            } else {
                // Módulo sin submódulos
                const moduleName = module.name.padEnd(15).slice(0, 15);
                console.log(`│ ${moduleName} │ Sin submódulos │ --------------  │ ----------------------------- │`);
            }
        }

        console.log('└─────────────────┴─────────────────┴──────────────────┴────────────────────────────────┘');

        // Mostrar totales
        console.log('\n=== TOTALES ===');
        console.log(`📊 Total de módulos: ${totalModules}`);
        console.log(`📊 Total de submódulos: ${totalSubmodules}`);
        console.log(`📊 Total de permisos: ${totalPermissions}`);

        // Mostrar todos los códigos de permisos en una lista
        console.log('\n=== LISTA DE CÓDIGOS DE PERMISOS ===');
        for (const module of modules) {
            for (const submodule of module.submodules) {
                for (const permission of submodule.permissions) {
                    console.log(`- ${permission.code} (${permission.name})`);
                }
            }
        }

    } catch (error) {
        console.error("\n❌ Error al consultar permisos:", error.message);
        console.error("Stack:", error.stack);
    } finally {
        await db.sequelize.close();
    }
}

testPermissions();
