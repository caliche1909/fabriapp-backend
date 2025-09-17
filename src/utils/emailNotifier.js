const nodemailer = require('nodemailer');
const path = require('path');
const { google } = require('googleapis');
const { getWelcomeEmailTemplate, getAdminNotificationTemplate, getResetPasswordEmailTemplate } = require('./email');
require('dotenv').config();

/**
 * Obtiene un token de acceso de Google.
 * Detecta automáticamente el entorno para usar la Cuenta de Servicio en producción
 * o el archivo de credenciales en desarrollo local.
 */
async function getAccessToken() {
    // En producción (Cloud Run), usa la identidad de la cuenta de servicio (ADC)
    if (process.env.NODE_ENV === 'production') {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://mail.google.com/'],
            // No se necesita keyFile, ¡es automático en Cloud Run!
            subject: process.env.GMAIL_USER
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();
        return accessToken.token;
    } else {
        // En desarrollo (local), usa el archivo de credenciales JSON
        const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!keyFilePath) {
            throw new Error('La variable de entorno GOOGLE_APPLICATION_CREDENTIALS no está definida para desarrollo local.');
        }
        const absoluteCredentialsPath = path.resolve(keyFilePath);
        const auth = new google.auth.JWT({
            keyFile: absoluteCredentialsPath,
            scopes: ['https://mail.google.com/'],
            subject: process.env.GMAIL_USER
        });
        const accessToken = await auth.getAccessToken();
        return accessToken.token;
    }
}

/**
 * Crea un transporter de Nodemailer configurado con un token de acceso fresco.
 */
async function createTransporter() {
    const accessToken = await getAccessToken();

    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            type: 'OAuth2',
            user: process.env.GMAIL_USER,
            accessToken: accessToken,
        }
    });
}

// --- Las funciones de envío de correo permanecen igual, pero ahora usarán el nuevo createTransporter ---

async function notifyAdmin(notificationData) {
    try {
        const transporter = await createTransporter();
        const template = getAdminNotificationTemplate(notificationData);
        const mailOptions = {
            from: `"Sistema de Imágenes" <${process.env.GMAIL_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: template.subject,
            html: template.html,
            text: template.text
        };
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error al enviar notificación al admin:', error);
        return false;
    }
}

async function sendWelcomeEmail(userData) {
    try {
        const transporter = await createTransporter();
        const template = getWelcomeEmailTemplate(userData);
        const mailOptions = {
            from: `"FabriApp - SistemApp" <${process.env.GMAIL_USER}>`,
            to: userData.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        };
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error al enviar email de bienvenida:', error);
        return false;
    }
}

async function sendPasswordResetEmail(userData, resetToken) {
    try {
        const transporter = await createTransporter();

        // Simplificado: FRONTEND_URL se configura de forma diferente en cada ambiente
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            console.error('FRONTEND_URL no está definida en las variables de entorno.');
            return false;
        }

        const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
        const expirationTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas       

        const template = getResetPasswordEmailTemplate(userData, resetLink, expirationTime);

        const mailOptions = {
            from: `"FabriApp - Recuperación de Contraseña" <${process.env.GMAIL_USER}>`,
            to: userData.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email de recuperación:', error);
        return false;
    }
}


module.exports = { notifyAdmin, sendWelcomeEmail, sendPasswordResetEmail };