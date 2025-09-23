const nodemailer = require('nodemailer');
const { getWelcomeEmailTemplate, getAdminNotificationTemplate, getResetPasswordEmailTemplate } = require('./email');
require('dotenv').config();

/**
 * Crea un transporter de Nodemailer configurado con App Password.
 */
async function createTransporter() {
    try {
        // Verificar variables de entorno requeridas
        if (!process.env.GMAIL_USER) {
            throw new Error('GMAIL_USER no está definido en las variables de entorno');
        }
        
        if (!process.env.GMAIL_APP_PASSWORD) {
            throw new Error('GMAIL_APP_PASSWORD no está definido en las variables de entorno');
        }

        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
    } catch (error) {
        console.error('❌ Error al crear transporter:', error);
        throw error;
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
        console.log('🔧 Iniciando envío de email de recuperación...');
        const transporter = await createTransporter();

        // Simplificado: FRONTEND_URL se configura de forma diferente en cada ambiente
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            console.error('FRONTEND_URL no está definida en las variables de entorno.');
            return false;
        }

        const resetLink = `${frontendUrl}/empresa/reset-password?token=${resetToken}`;
        const expirationTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas       

        console.log('📧 Configurando template de email...');
        const template = getResetPasswordEmailTemplate(userData, resetLink, expirationTime);

        const mailOptions = {
            from: `"FabriApp - Recuperación de Contraseña" <${process.env.GMAIL_USER}>`,
            to: userData.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        };

        console.log('📤 Enviando email a:', userData.email);
        await transporter.sendMail(mailOptions);
        console.log('✅ Email enviado exitosamente');
        return true;
    } catch (error) {
        console.error('❌ Error al enviar email de recuperación:', error);
        console.error('❌ Error stack:', error.stack);
        return false;
    }
}


module.exports = { notifyAdmin, sendWelcomeEmail, sendPasswordResetEmail };