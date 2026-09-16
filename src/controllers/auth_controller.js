const { users, password_resets, sequelize } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/emailNotifier');

const SALT_ROUNDS = 10;
const SECRET_KEY = process.env.JWT_SECRET;

/**
 * La ÚNICA respuesta de "olvidé mi contraseña" por correo, exista la cuenta o no.
 *
 * Vive en una constante justamente para que no pueda divergir: dos textos parecidos escritos en
 * dos sitios acaban separándose, y en cuanto se separan vuelve la enumeración de usuarios.
 */
const MENSAJE_RECUPERACION =
    'Si el correo está registrado, te enviamos un enlace para recuperar tu contraseña. ' +
    'Revisa también la carpeta de spam.';

module.exports = {
    // 📌 RECUPERAR CONTRASEÑA
    async forgotPassword(req, res) {
        const transaction = await sequelize.transaction();

        try {
            const { method, email, phone, countryCode, timezone, timezoneOffset } = req.body;
            const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

            // Validar método
            if (!['email', 'whatsapp'].includes(method)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Método de recuperación inválido'
                });
            }

            let user;
            let sentTo;

            // Buscar usuario según el método
            if (method === 'email') {
                // Validamos que el email esté presente en los parámetros
                if (!email) {
                    return res.status(400).json({
                        success: false,
                        status: 400,
                        message: 'Faltan datos para recuperar contraseña'
                    });
                }

                // Buscar usuario por email
                const userInDB = await users.findOne({
                    where: {
                        email: email.toLowerCase(),
                        status: 'active'
                    },
                    transaction
                });

                if (!userInDB) {
                    /**
                     * 🔴 RESPONDE COMO SI EL CORREO EXISTIERA (2026-09-15).
                     *
                     * Es la misma fuga que se cerró en el login, y aquí era **más fácil de
                     * explotar**: no hace falta ni intentar una contraseña. Un 404 diciendo "ese
                     * correo no está asociado a ninguna cuenta" le confirma a cualquiera, correo
                     * por correo, quién tiene cuenta en FabriApp.
                     *
                     * El mensaje tiene que ser **idéntico** al del camino bueno —byte por byte— o
                     * la fuga sigue abierta. Si alguien lo cambia, que cambie los dos.
                     *
                     * ⚠️ Coste conocido y aceptado: quien se equivoque al teclear su correo ya no
                     * recibe un "ese correo no existe"; verá el mismo mensaje y esperará un email
                     * que no llega. Por eso el texto invita a revisar el spam y a reintentar.
                     *
                     * ⚠️ Y de paso: aquí se volvía sin cerrar la transacción. Una transacción
                     * abierta y abandonada queda como `idle in transaction` y bloquea a las
                     * siguientes (ver el README de `server/pruebas/`).
                     */
                    await transaction.rollback();
                    return res.status(200).json({
                        success: true,
                        status: 200,
                        message: MENSAJE_RECUPERACION
                    });
                }

                user = userInDB;
                sentTo = userInDB.email;

                // Invalidar tokens anteriores del usuario para email
                await password_resets.update(
                    { used_at: new Date() },
                    {
                        where: {
                            user_id: user.id,
                            method: 'email',
                            used_at: null,
                            expires_at: { [Op.gt]: new Date() }
                        },
                        transaction
                    }
                );

                // Generar token JWT para email (válido por 24 horas)
                const resetToken = jwt.sign(
                    {
                        userId: user.id,
                        email: user.email,
                        type: 'password_reset'
                    },
                    SECRET_KEY,
                    { expiresIn: '24h' }
                );

                // Calcular tiempo de expiración (considerar zona horaria del usuario si se proporciona)
                let expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas por defecto

                if (timezone && timezoneOffset) {
                    // Ajustar según la zona horaria del usuario
                    const userOffset = timezoneOffset * 60 * 1000; // Convertir minutos a millisegundos
                    const serverOffset = new Date().getTimezoneOffset() * 60 * 1000;
                    const offsetDiff = serverOffset - userOffset;
                    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000 + offsetDiff);
                }

                // Crear registro en password_resets
                await password_resets.create({
                    user_id: user.id,
                    token: resetToken,
                    verification_code: null,
                    method: 'email',
                    sent_to: sentTo,
                    expires_at: expiresAt,
                    ip_address_of_request: clientIP
                }, { transaction });

                // Enviar email de recuperación
                const emailSent = await sendPasswordResetEmail(
                    {
                        name: `${user.first_name} ${user.last_name}`,
                        email: user.email
                    },
                    resetToken
                );

                if (!emailSent) {
                    await transaction.rollback();
                    return res.status(500).json({
                        success: false,
                        status: 500,
                        message: 'Error al enviar el correo de recuperación'
                    });
                }

                await transaction.commit();

                // El MISMO mensaje que cuando el correo no existe: ahí está la protección.
                res.status(200).json({
                    success: true,
                    status: 200,
                    message: MENSAJE_RECUPERACION
                });

            } else {
                // TODO: Implementar método WhatsApp en el siguiente paso
                await transaction.rollback();
                res.status(501).json({
                    success: false,
                    status: 501,
                    message: 'Funcionalidad no implementada aun, intenta usando tu email.'
                });
            }

        } catch (error) {
            await transaction.rollback();
            console.error('❌ Error en forgotPassword:', error);
            console.error('❌ Error stack:', error.stack);
            console.error('❌ Error message:', error.message);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

    },

    // 📌 VALIDAR TOKEN DE RECUPERACIÓN
    async validateResetToken(req, res) {
        const transaction = await sequelize.transaction();
        
        try {
            const { token } = req.params;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Acceso no autorizado'
                });
            }

            // Verificar el JWT
            let decoded;
            try {
                decoded = jwt.verify(token, SECRET_KEY);
            } catch (jwtError) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Acceso no autorizado'
                });
            }

            // Verificar que existe en la base de datos y no ha sido usado
            const resetRecord = await password_resets.findOne({
                where: {
                    token: token,
                    used_at: null,
                    expires_at: { [Op.gt]: new Date() }
                },
                include: [{
                    model: users,
                    as: 'user',
                    attributes: ['id', 'email', 'first_name', 'last_name']
                }],
                transaction
            });

            if (!resetRecord) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Acceso no autorizado'
                });
            }

            // 🔍 ACTUALIZAR verified_at cuando el usuario hace click en el enlace del email
            await password_resets.update(
                { verified_at: new Date() },
                { 
                    where: { id: resetRecord.id },
                    transaction 
                }
            );           

            await transaction.commit();

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Token válido',
                data: {
                    userEmail: resetRecord.user.email,
                    userName: `${resetRecord.user.first_name} ${resetRecord.user.last_name}`
                }
            });

        } catch (error) {
            await transaction.rollback();
            console.error('❌ Error en validateResetToken:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    },

    // 📌 RESTABLECER CONTRASEÑA
    async resetPassword(req, res) {
        const transaction = await sequelize.transaction();

        try {
            const { token, newPassword } = req.body;

            if (!token || !newPassword) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Faltan datos para actualizar la contraseña'
                });
            }

            // Validar que la contraseña tenga al menos 8 caracteres
            if (newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El formato de la contraseña no es inválido'
                });
            }

            // Verificar el JWT
            let decoded;
            try {
                decoded = jwt.verify(token, SECRET_KEY);
            } catch (jwtError) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Usuario no encontrado'
                });
            }

            // Verificar que existe en la base de datos y no ha sido usado
            const resetRecord = await password_resets.findOne({
                where: {
                    token: token,
                    used_at: null,
                    expires_at: { [Op.gt]: new Date() }
                },
                include: [{
                    model: users,
                    as: 'user'
                }],
                transaction
            });

            if (!resetRecord) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Usuario no autorizado'
                });
            }

            // Hashear la nueva contraseña
            const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

            // Actualizar la contraseña del usuario
            await users.update(
                { password: hashedPassword },
                {
                    where: { id: resetRecord.user.id },
                    transaction
                }
            );

            // Marcar el token como usado
            await password_resets.update(
                { used_at: new Date() },
                {
                    where: { id: resetRecord.id },
                    transaction
                }
            );

           

            await transaction.commit();

            res.status(200).json({
                success: true,
                status: 200,
                message: 'Contraseña actualizada exitosamente'
            });

        } catch (error) {
            await transaction.rollback();
            console.error('❌ Error en resetPassword:', error);
            res.status(500).json({
                success: false,
                status: 500,
                message: 'Error interno del servidor'
            });
        }
    }

}