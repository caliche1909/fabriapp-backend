const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

async function checkAuth() {
    try {
        console.log('--- Iniciando Diagnóstico de Autenticación (Nivel 4 - Método Alternativo) ---');

        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const userToImpersonate = process.env.GMAIL_USER;
        const absoluteCredentialsPath = path.resolve(credentialsPath);

        console.log(`- Intentando autenticar usando el archivo de claves directamente: ${absoluteCredentialsPath}`);

        // --- MÉTODO ALTERNATIVO ---
        // En lugar de pasar los contenidos, pasamos la ruta al archivo
        const auth = new google.auth.JWT({
            keyFile: absoluteCredentialsPath,
            scopes: ['https://www.googleapis.com/auth/gmail.send'],
            subject: userToImpersonate
        });
        // --- FIN DE MÉTODO ALTERNATIVO ---

        await auth.getAccessToken();

        console.log('----------------------------------------------------------');
        console.log('✅ ¡ÉXITO! La autenticación con Google funciona con este método.');
        console.log('----------------------------------------------------------');
        console.log('Esto confirma que hay un bug en la librería y que este método alternativo es la solución.');
        console.log('Ahora, aplica un cambio similar en tu código de nodemailer.');


    } catch (error) {
        console.log('----------------------------------------------------------');
        console.error('❌ ¡FALLO INEXPLICABLE! Incluso el método alternativo falló.');
        console.error('Detalles del error:', error.message);
    }
}

checkAuth();