const nodemailer = require('nodemailer');
const path = require('path');
const { google } = require('googleapis'); // <--- IMPORTANTE
const { getWelcomeEmailTemplate, getAdminNotificationTemplate, getResetPasswordEmailTemplate } = require('./email');
require('dotenv').config();

// --- INICIO DE LA SOLUCIÓN DEFINITIVA ---

const absoluteCredentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);

/**
 * Crea un cliente de autenticación de Google y obtiene un token de acceso.
 * Este es el método que sabemos que funciona gracias al diagnóstico.
 */
async function getAccessToken() {
    const auth = new google.auth.JWT({
        keyFile: absoluteCredentialsPath,
        scopes: ['https://mail.google.com/'],
        subject: process.env.GMAIL_USER
    });
    const accessToken = await auth.getAccessToken();
    return accessToken.token;
}

/**
 * Crea un transporter de Nodemailer configurado con el token de acceso obtenido.
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
            accessToken: accessToken, // <--- Usamos el token que generamos manualmente
        }
    });
}



// Modificamos las funciones para que obtengan un transporter nuevo en cada envío.
// Esto asegura que el token de acceso no haya expirado.

async function notifyAdmin(notificationData) {
    try {
        const transporter = await createTransporter(); // Obtiene transporter con token fresco
        const template = getAdminNotificationTemplate(notificationData);
        const mailOptions = {
            from: `"Sistema de Imágenes" <${process.env.GMAIL_USER}>`,
            to: process.env.ADMIN_EMAIL,
            subject: template.subject,
            html: template.html,
            text: template.text
        };
        const info = await transporter.sendMail(mailOptions);
        
        return true;
    } catch (error) {
        console.error('Error al enviar notificación al admin:', error);
        return false;
    }
}

async function sendWelcomeEmail(userData) {
    try {
        const transporter = await createTransporter(); // Obtiene transporter con token fresco
        const template = getWelcomeEmailTemplate(userData);
        const mailOptions = {
            from: `"FabriApp - SistemApp" <${process.env.GMAIL_USER}>`,
            to: userData.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        };

        const info = await transporter.sendMail(mailOptions);
   
        return true;
    } catch (error) {
        console.error('Error al enviar email de bienvenida:', error);
        return false;
    }
}

async function sendPasswordResetEmail(userData, resetToken) {
    try {
        const transporter = await createTransporter(); // Obtiene transporter con token fresco
        
        // 🌍 DETECCIÓN AUTOMÁTICA DEL AMBIENTE
        const isProduction = process.env.NODE_ENV === 'production';
        const frontendUrl = isProduction 
            ? process.env.FRONTEND_URL_PRODUCTION 
            : process.env.FRONTEND_URL;
            
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

        const info = await transporter.sendMail(mailOptions);
        
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email de recuperación:', error);
        return false;
    }
}

module.exports = { notifyAdmin, sendWelcomeEmail, sendPasswordResetEmail };