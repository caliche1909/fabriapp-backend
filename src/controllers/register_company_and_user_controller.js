const { users, roles, companies, sequelize } = require('../models');
const crypto = require('crypto');
const { sendWelcomeEmail, notifyAdmin } = require('../utils/emailNotifier');

module.exports = {
    async registerCompanyAndUser(req, res) {
        let newUser = null;
        let newCompany = null;
        let transaction = null;
        let plainPassword = null;

        try {
            const { fullName, email, phone, companyName } = req.body;

            // 1. Validar campos requeridos
            if (!fullName || !email || !phone || !companyName) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Todos los campos son requeridos'
                });
            }

            // 1.1 Validar formato del email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Email invalido'
                });
            }

            // 1.2 Validar formato del teléfono
            const phoneRegex = /^[\d-]{9,19}$/;
            if (!phoneRegex.test(phone)) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Numero de telefono invalido'
                });
            }

            // 2. Verificar si el email ya existe (fuera de transacción)
            const existingEmail = await users.findOne({ where: { email } });
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El email ya está registrado'
                });
            }

            // 3. Verificar si el teléfono ya existe (fuera de transacción)
            const existingPhone = await users.findOne({ where: { phone } });
            if (existingPhone) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El teléfono ya está registrado'
                });
            }

            // 4. Preparar datos
            const [firstName, ...lastNameParts] = fullName.trim().split(' ');
            const lastName = lastNameParts.join(' ');
            plainPassword = crypto.randomBytes(8).toString('hex');

            // 5. Iniciar transacción
            transaction = await sequelize.transaction();

            try {
                // 5.1 Obtener el rol super_admin
                const superAdminRole = await roles.findOne({
                    where: {
                        name: 'SUPER_ADMIN',
                        is_global: true
                    },
                    transaction
                });

                if (!superAdminRole) {
                    throw new Error('El rol SUPER_ADMIN no existe en el sistema');
                }

                // 5.2 Crear el usuario (el modelo se encargará de hashear la contraseña)
                newUser = await users.create({
                    email,
                    password: plainPassword,
                    first_name: firstName,
                    last_name: lastName,
                    phone,
                    role_id: superAdminRole.id,
                    status: 'active'
                }, { transaction });

                // 5.3 Crear la compañía
                newCompany = await companies.create({
                    name: companyName,
                    legal_name: companyName,
                    email,
                    phone,
                    owner_id: newUser.id,
                    is_active: true,
                    is_default: true
                }, { transaction });

                // 5.4 Confirmar la transacción
                await transaction.commit();

                // 6. Enviar email de bienvenida (fuera de la transacción)
                const welcomeEmailData = {
                    email: newUser.email,
                    fullName: `${firstName} ${lastName}`,
                    companyName: companyName,
                    password: plainPassword // Enviamos la contraseña sin hashear
                };

                const emailSent = await sendWelcomeEmail(welcomeEmailData);
                if (!emailSent) {
                    // Si falla el envío del email, hacemos rollback manual
                    await users.destroy({ where: { id: newUser.id }, force: true });
                    await companies.destroy({ where: { id: newCompany.id }, force: true });
                    
                    throw new Error('Error al enviar el email de bienvenida');
                }

                // 7. Notificar al equipo de SistemApp (fuera de la transacción)
                const adminNotificationData = {
                    type: 'NEW_USER_REGISTRATION',
                    userData: {
                        fullName: `${firstName} ${lastName}`,
                        email: email,
                        phone: phone,
                        companyName: companyName,
                        registrationDate: new Date().toISOString()
                    }
                };

                await notifyAdmin(adminNotificationData);

                // 8. Si llegamos aquí, todo se completó correctamente
                return res.status(201).json({
                    success: true,
                    status: 201,
                    message: 'Registro exitoso'
                });

            } catch (innerError) {
                // Si algo falla durante la transacción, hacemos rollback
                if (transaction) await transaction.rollback();
                throw innerError;
            }

        } catch (error) {
            console.error('❌ Error en el proceso de registro:', error);

            // Manejar diferentes tipos de errores
            let statusCode = 500;
            let message = 'Error en el proceso de registro';

            if (error.message.includes('SUPER_ADMIN no existe')) {
                statusCode = 500;
                message = 'Error en la configuración del sistema';
            } else if (error.message.includes('email de bienvenida')) {
                statusCode = 500;
                message = 'Error al enviar el email de bienvenida. Por favor, intente nuevamente.';
            }

            return res.status(statusCode).json({
                success: false,
                status: statusCode,
                message: message
            });
        }
    }
};
