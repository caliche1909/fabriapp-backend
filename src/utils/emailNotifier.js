const nodemailer = require('nodemailer');
const { getWelcomeEmailTemplate, getAdminNotificationTemplate } = require('./email');
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
        const template = getAdminNotificationTemplate(notificationData);
        const mailOptions = {
            from: `"Sistema de Imágenes" <${process.env.SMTP_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: template.subject,
            html: template.html,
            text: template.text
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Notificación enviada al admin:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error al enviar notificación al admin:', error);
        return false;
    }
}

// Función para enviar email de bienvenida
async function sendWelcomeEmail(userData) {
    try {
        const template = getWelcomeEmailTemplate(userData);
        const mailOptions = {
            from: `"FabriApp - SistemApp" <${process.env.SMTP_USER}>`,
            to: userData.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email de bienvenida enviado:', info.messageId);
        return true;
    } catch (error) {
        console.error('Error al enviar email de bienvenida:', error);
        return false;
    }
}

module.exports = { notifyAdmin, sendWelcomeEmail };