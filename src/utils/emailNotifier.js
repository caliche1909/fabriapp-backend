const nodemailer = require('nodemailer');
require('dotenv').config();

// Configuración del transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true para 465, false para otros puertos
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    },
    tls: {
        rejectUnauthorized: false // Solo para desarrollo/testing
    }
});

// Función para notificar al admin
async function notifyAdmin(notificationData) {
    try {
        const mailOptions = {
            from: `"Sistema de Imágenes" <${process.env.SMTP_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: `⚠️ Alerta del Sistema: ${notificationData.type || 'Error crítico'}`,
            html: `
                <h2>Se requiere acción manual</h2>
                <p><strong>Tipo:</strong> ${notificationData.type || 'ORPHANED_IMAGE'}</p>
                <p><strong>Public ID:</strong> ${notificationData.publicId}</p>
                <p><strong>Usuario ID:</strong> ${notificationData.userId}</p>
                <p><strong>URL de imagen:</strong> <a href="${notificationData.imageUrl}">${notificationData.imageUrl}</a></p>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                <br>
                <p>Por favor revisa este incidente lo antes posible.</p>
            `,
            text: `Se requiere acción manual:
                   Tipo: ${notificationData.type || 'ORPHANED_IMAGE'}
                   Public ID: ${notificationData.publicId}
                   Usuario ID: ${notificationData.userId}
                   URL: ${notificationData.imageUrl}
                   Timestamp: ${new Date().toISOString()}`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Notificación enviada al admin:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error al enviar notificación al admin:', error);
        return false;
    }
}

module.exports = { notifyAdmin };