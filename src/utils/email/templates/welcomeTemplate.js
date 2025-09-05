const getWelcomeEmailTemplate = (userData) => ({
    subject: `¡Bienvenido a FabriApp! - Información de acceso`,
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
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .header {
                    background-color: #062548;
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
                .footer {
                    text-align: center;
                    margin-top: 20px;
                    padding: 20px;
                    font-size: 12px;
                    color: #666666;
                }
                .button {
                    display: inline-block;
                    padding: 12px 24px;
                    background-color: #3498DB;
                    color:rgba(255, 255, 255, 0.9);
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 20px 0;
                    box-shadow: 0 4px 6px rgba(109, 108, 108, 0.2);
                }
                .credentials {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                    border-left: 4px solid #0182d0;
                    box-shadow: 0 4px 6px rgba(146, 143, 143, 0.4);
                }
                .highlight {
                    color: #0182d0;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>¡Bienvenido a FabriApp!</h1>
                </div>
                <div class="content">
                    <h2>Hola ${userData.fullName},</h2>
                    
                    <p>¡Nos complace darle la bienvenida a <strong>FabriApp</strong>, la solución integral para la gestión empresarial!</p>

                    <p>Su cuenta ha sido creada exitosamente para la empresa: <strong>${userData.companyName}</strong></p>

                    <div class="credentials">
                        <h3>Sus credenciales de acceso:</h3>
                        <p><strong>Email:</strong> ${userData.email}</p>
                        <p><strong>Contraseña temporal:</strong> ${userData.password}</p>
                        <p><em>Por seguridad, le recomendamos cambiar su contraseña en su primer inicio de sesión.</em></p>
                    </div>

                    <p>Con FabriApp, usted tendrá acceso a:</p>
                    <ul>
                        <li>Gestión integral de inventario</li>
                        <li>Sistema de ventas y reportes</li>
                        <li>Control de producción en tiempo real</li>
                        <li>Rutas y reparto de productos </li>
                        <li>Seguimiento ubicacion de repartidores y vehiculos </li>
                        <li>Administración de usuarios y roles</li>
                        <li>Reportes detallados y análisis</li>
                     
                        <li>Y mucho más...</li>
                    </ul>

                    <p>Nuestro equipo de desarrollo está comprometido con la excelencia y la innovación continua. Contamos con más de 5 años de experiencia desarrollando soluciones empresariales de alta calidad.</p>

                    <a href="${process.env.FRONTEND_URL}/login" class="button">Iniciar Sesión</a>

                    <p>Si tiene alguna pregunta o necesita asistencia, no dude en contactarnos:</p>
                    <ul>
                        <li>Email: soporte@fabriapp.com</li>
                        <li>Teléfono: +57 323 295 1780</li>
                        
                    </ul>
                </div>
                <div class="footer">
                    <p>Este es un correo automático, por favor no responda a este mensaje.</p>
                    <p>© ${new Date().getFullYear()} SistemApp - Todos los derechos reservados</p>
                    <p>Desarrollado con ❤️ por el equipo de SistemApp</p>
                </div>
            </div>
        </body>
        </html>
    `,
    text: `
        ¡Bienvenido a FabriApp!
        
        Hola ${userData.fullName},
        
        Su cuenta ha sido creada exitosamente para la empresa: ${userData.companyName}
        
        Credenciales de acceso:
        Email: ${userData.email}
        Contraseña temporal: ${userData.password}
        
        Por seguridad, le recomendamos cambiar su contraseña en su primer inicio de sesión.
        
        Puede iniciar sesión en: ${process.env.FRONTEND_URL}/login
        
        Si necesita ayuda, contáctenos:
        Email: soporte@fabriapp.com
        Teléfono: +57 323 295 1780

        © ${new Date().getFullYear()} FabriApp - Todos los derechos reservados
    `
});

module.exports = getWelcomeEmailTemplate;   