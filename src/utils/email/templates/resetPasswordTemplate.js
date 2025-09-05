const getResetPasswordEmailTemplate = (userData, resetLink, expirationTime) => {
    // Calcular tiempo restante en formato legible
    const now = new Date();
    const expiration = new Date(expirationTime);
    const diffMs = expiration - now;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;
    
    let timeRemaining;
    if (diffHours > 0) {
        timeRemaining = `${diffHours} hora${diffHours > 1 ? 's' : ''} y ${remainingMinutes} minuto${remainingMinutes !== 1 ? 's' : ''}`;
    } else {
        timeRemaining = `${diffMinutes} minuto${diffMinutes !== 1 ? 's' : ''}`;
    }

    return {
        subject: `🔐 Recuperar Contraseña - FabriApp`,
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
                        margin: 0;
                        padding: 0;
                        background-color: #f5f5f5;
                    }
                    .container {
                        max-width: 600px;
                        margin: 20px auto;
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    }
                    .header {
                        background-color: #062548;
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 5px 5px 0 0;
                        position: relative;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 24px;
                        font-weight: bold;
                    }
                    .security-shield {
                        font-size: 40px;
                        margin: 10px 0;
                        display: inline-block;
                        animation: pulse 2s ease-in-out infinite;
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    }
                    @keyframes pulse {
                        0% { 
                            transform: scale(1);
                            opacity: 1;
                        }
                        50% { 
                            transform: scale(1.05);
                            opacity: 0.8;
                        }
                        100% { 
                            transform: scale(1);
                            opacity: 1;
                        }
                    }
                    .content {
                        background-color: #ffffff;
                        padding: 30px;
                        border: 1px solid #dddddd;
                        border-radius: 0 0 5px 5px;
                    }
                    .greeting {
                        font-size: 20px;
                        color: #00276c;
                        margin-bottom: 20px;
                        font-weight: 600;
                    }
                    .message {
                        font-size: 16px;
                        color: #333333;
                        margin-bottom: 25px;
                        line-height: 1.8;
                    }
                    .reset-button {
                        display: inline-block;
                        padding: 15px 30px;
                        background-color: #3498DB;
                        color: #ffffff;
                        text-decoration: none;
                        border-radius: 5px;
                        margin: 20px 0;
                        box-shadow: 0 4px 6px rgba(109, 108, 108, 0.2);
                        font-weight: bold;
                        font-size: 16px;
                        transition: all 0.3s ease;
                    }
                    .reset-button:hover {
                        background-color: #42a5f5;
                        transform: translateY(-2px);
                        box-shadow: 0 6px 12px rgba(109, 108, 108, 0.3);
                    }
                    .expiration-info {
                        background-color: #f8f9fa;
                        padding: 15px;
                        border-radius: 5px;
                        margin: 20px 0;
                        border-left: 4px solid #0182d0;
                        box-shadow: 0 4px 6px rgba(146, 143, 143, 0.4);
                    }
                    .expiration-time {
                        font-weight: bold;
                        color: #fd4234;
                    }
                    .security-note {
                        background-color: #e8f4fd;
                        border-left: 4px solid #0182d0;
                        padding: 15px;
                        margin: 20px 0;
                        border-radius: 5px;
                        color: #00276c;
                        font-size: 14px;
                    }
                    .closing {
                        margin-top: 25px;
                        font-size: 16px;
                        color: #333333;
                    }
                    .signature {
                        margin-top: 15px;
                        font-weight: 600;
                        color: #00276c;
                    }
                    .footer {
                        text-align: center;
                        margin-top: 20px;
                        padding: 20px;
                        font-size: 12px;
                        color: #666666;
                        background-color: #f8f9fa;
                        border-radius: 5px;
                    }
                    .highlight {
                        color: #0182d0;
                        font-weight: bold;
                    }
                    @media (max-width: 600px) {
                        .container {
                            margin: 10px;
                        }
                        .content {
                            padding: 20px;
                        }
                        .header {
                            padding: 15px;
                        }
                        .reset-button {
                            padding: 12px 25px;
                            font-size: 14px;
                        }
                        .security-shield {
                            font-size: 35px;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Recuperar Contraseña</h1>
                        <div class="security-shield">🛡️</div>
                    </div>
                    
                    <div class="content">
                        <h2 class="greeting">Hola ${userData.name || 'Usuario'},</h2>
                        
                        <p class="message">
                            Hemos recibido una solicitud para recuperar la contraseña de tu cuenta en <strong class="highlight">FabriApp</strong>.
                        </p>

                        <p class="message">
                            Por tu seguridad, haz clic en el siguiente botón para restablecer tu contraseña de forma segura:
                        </p>
                        
                        <a href="${resetLink}" class="reset-button" target="_blank" rel="noopener noreferrer">
                            🔑 Restablecer Contraseña
                        </a>
                        
                        <div class="expiration-info">
                            <h3>⏰ Tiempo de validez:</h3>
                            <p>Este enlace será válido durante: <span class="expiration-time">${timeRemaining}</span></p>
                            <p><em>Después de este tiempo, deberás solicitar un nuevo enlace de recuperación.</em></p>
                        </div>
                        
                        <div class="security-note">
                            <strong>🛡️ Nota de Seguridad:</strong> Si no solicitaste este cambio de contraseña, 
                            puedes ignorar este correo con total tranquilidad. Tu cuenta permanece completamente segura.
                        </div>
                        
                        <p class="closing">
                            Que tengas un excelente día. 😊
                        </p>
                        
                        <p class="signature">
                            Atentamente,<br>
                            <strong>El equipo de FabriApp</strong>
                        </p>                        
                    </div>
                    
                    <div class="footer">
                        <p>Este es un correo automático, por favor no responda a este mensaje.</p>
                        <p>© ${new Date().getFullYear()} FabriApp - Sistema de Gestión Empresarial</p>
                        <p>Desarrollado con ❤️ por el equipo de SystemApp</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
Recuperar Contraseña - FabriApp

Hola ${userData.name || 'Usuario'},

Hemos recibido una solicitud para recuperar la contraseña de tu cuenta en FabriApp.

Para restablecer tu contraseña, haz clic en el siguiente enlace:
${resetLink}

El enlace será válido durante: ${timeRemaining}

Si no solicitaste este cambio de contraseña, puedes ignorar este correo.

Gracias por confiar en nosotros.

Atentamente,
El equipo de FabriApp

Si necesitas ayuda, contáctanos:
Email: soporte@fabriapp.com
Teléfono: +57 323 295 1780

---
© ${new Date().getFullYear()} FabriApp - Sistema de Gestión Empresarial
Este es un correo automático, por favor no responder.
        `
    };
};

module.exports = getResetPasswordEmailTemplate;
