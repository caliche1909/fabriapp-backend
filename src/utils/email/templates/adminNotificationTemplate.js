const getAdminNotificationTemplate = (notificationData) => {
    let subject, content;

    switch (notificationData.type) {
        case 'NEW_USER_REGISTRATION':
            subject = `🎉 Nuevo Registro en FabriApp: ${notificationData.userData.companyName}`;
            content = {
                title: 'Nuevo Usuario Registrado',
                details: [
                    { label: 'Empresa', value: notificationData.userData.companyName },
                    { label: 'Nombre', value: notificationData.userData.fullName },
                    { label: 'Email', value: notificationData.userData.email },
                    { label: 'Teléfono', value: notificationData.userData.phone },
                    { label: 'Fecha de Registro', value: new Date(notificationData.userData.registrationDate).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) }
                ]
            };
            break;
        case 'ORPHANED_IMAGE':
            subject = `⚠️ Alerta del Sistema: Imagen Huérfana Detectada`;
            content = {
                title: 'Se Requiere Acción Manual',
                details: [
                    { label: 'Public ID', value: notificationData.publicId },
                    { label: 'Usuario ID', value: notificationData.userId },
                    { label: 'URL de imagen', value: notificationData.imageUrl },
                    { label: 'Timestamp', value: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) }
                ]
            };
            break;
        default:
            subject = `⚠️ Alerta del Sistema: ${notificationData.type || 'Notificación'}`;
            content = {
                title: 'Se Requiere Atención',
                details: Object.entries(notificationData).map(([key, value]) => ({
                    label: key,
                    value: value
                }))
            };
    }

    return {
        subject,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333333;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .header {
                    background-color: #2C3E50;
                    color: white;
                    padding: 20px;
                    text-align: center;
                    border-radius: 5px 5px 0 0;
                }
                .content {
                    background-color: #ffffff;
                    padding: 30px;
                    border: 1px solid #dddddd;
                    border-radius: 0 0 5px 5px;
                }
                .details {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #3498DB;
                }
                .detail-row {
                    margin: 10px 0;
                    padding: 5px 0;
                    border-bottom: 1px solid #eee;
                }
                .detail-label {
                    font-weight: bold;
                    color: #2C3E50;
                }
                .footer {
                    text-align: center;
                    margin-top: 20px;
                    padding: 20px;
                    font-size: 12px;
                    color: #666666;
                }
                .highlight {
                    color: #3498DB;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${content.title}</h1>
                </div>
                <div class="content">
                    <div class="details">
                        ${content.details.map(detail => `
                            <div class="detail-row">
                                <span class="detail-label">${detail.label}:</span>
                                <span>${detail.value}</span>
                            </div>
                        `).join('')}
                    </div>
                    ${notificationData.type === 'NEW_USER_REGISTRATION' ? `
                        <p>🎯 <strong>Acciones Recomendadas:</strong></p>
                        <ul>
                            <li>Dar seguimiento de bienvenida en 24-48 horas</li>
                            <li>Verificar la información de la empresa</li>
                            <li>Actualizar CRM con los nuevos datos</li>
                            <li>Programar sesión de onboarding si es necesario</li>
                        </ul>
                    ` : ''}
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} SistemApp - Sistema de Notificaciones Administrativas</p>
                </div>
            </div>
        </body>
        </html>
        `,
        text: `
${content.title}

${content.details.map(detail => `${detail.label}: ${detail.value}`).join('\n')}

${notificationData.type === 'NEW_USER_REGISTRATION' ? `
Acciones Recomendadas:
- Dar seguimiento de bienvenida en 24-48 horas
- Verificar la información de la empresa
- Actualizar CRM con los nuevos datos
- Programar sesión de onboarding si es necesario
` : ''}

© ${new Date().getFullYear()} SistemApp - Sistema de Notificaciones Administrativas
        `
    };
};

module.exports = getAdminNotificationTemplate; 