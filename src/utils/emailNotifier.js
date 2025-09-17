const nodemailer = require('nodemailer');
const path = require('path');
const { google } = require('googleapis');
const { getWelcomeEmailTemplate, getAdminNotificationTemplate, getResetPasswordEmailTemplate } = require('./email');
require('dotenv').config();

/**
 * Crea un transporter de Nodemailer configurado OAuth2 optimizado.
 */
async function createTransporter() {
    if (process.env.NODE_ENV === 'production') {
        // En producción, usa OAuth2 con configuración optimizada
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://mail.google.com/'],
            subject: process.env.GMAIL_USER
        });
        
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: process.env.GMAIL_USER,
                // Usar el auth object directamente en lugar del token
                googleAuth: auth,
                accessToken: async () => {
                    const client = await auth.getClient();
                    const tokenResponse = await client.getAccessToken();
                    return tokenResponse.token;
                }
            }
        });
    } else {
        // En desarrollo, usa archivo de credenciales
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
        
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: process.env.GMAIL_USER,
                accessToken: accessToken.token,
            }
        });
    }
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

        const resetLink = `${frontendUrl}/empresa/reset-password?token=${resetToken}`;
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