const { users, roles, companies, sequelize } = require('../models');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET;

module.exports = {
    async registerCompanyAndUser(req, res) {
        let transaction;
        
        try {
            console.log("📌 Intentando registrar una empresa y un usuario...", req.body);
            const { fullName, email, phone, companyName } = req.body;

            // Validar campos requeridos
            if (!fullName || !email || !phone || !companyName) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Datos incompletos',
                    data: null
                });
            }

            // Verificar si el email ya existe
            const existingEmail = await users.findOne({ where: { email } });
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El email ya está registrado',
                    data: null
                });
            }

            // Verificar si el teléfono ya existe
            const existingPhone = await users.findOne({ where: { phone } });
            if (existingPhone) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El teléfono ya está registrado',
                    data: null
                });
            }

            // Iniciar transacción
            transaction = await sequelize.transaction();

            // 1. Generar contraseña aleatoria segura
            const password = crypto.randomBytes(8).toString('hex');
            console.log('🔑 Contraseña generada:', password); // Solo para desarrollo

            // 2. Separar nombre completo en nombre y apellido
            const [firstName, ...lastNameParts] = fullName.trim().split(' ');
            const lastName = lastNameParts.join(' ');

            // 3. Buscar o crear el rol de super_admin
            const [superAdminRole] = await roles.findOrCreate({
                where: { 
                    name: 'SUPER_ADMIN',
                    is_global: true
                },
                defaults: {
                    name: 'SUPER_ADMIN',
                    is_global: true
                },
                transaction
            });

            // 4. Crear el usuario
            const newUser = await users.create({
                email,
                password,
                first_name: firstName,
                last_name: lastName,
                phone,
                role_id: superAdminRole.id,
                status: 'active'
            }, { transaction });

            // 5. Crear la compañía
            const newCompany = await companies.create({
                name: companyName,
                legal_name: companyName,
                email,
                phone,
                owner_id: newUser.id,
                is_active: true
            }, { transaction });

            // 6. Confirmar la transacción
            await transaction.commit();

            // 7. Obtener datos completos del usuario
            const userWithData = await users.findOne({
                where: { id: newUser.id },
                include: [
                    {
                        model: roles,
                        as: 'role',
                        include: ['permissions']
                    },
                    {
                        model: companies,
                        as: 'owned_companies'
                    },
                    {
                        model: companies,
                        as: 'assigned_companies',
                        through: { attributes: [] }
                    }
                ]
            });

            if (!userWithData) {
                return res.status(500).json({
                    success: false,
                    status: 500,
                    message: 'Error al obtener los datos del usuario creado',
                    data: null
                });
            }

            // 8. Generar token JWT
            const token = jwt.sign(
                { 
                    id: userWithData.id, 
                    email: userWithData.email, 
                    role: userWithData.role.name 
                }, 
                SECRET_KEY, 
                { expiresIn: '8h' }
            );

            // 9. Enviar respuesta estandarizada
            return res.status(201).json({
                success: true,
                status: 201,
                message: 'Usuario y compañía creados exitosamente',
                data: {
                    token,
                    user: {
                        id: userWithData.id,
                        email: userWithData.email,
                        fullName: userWithData.getFullName(),
                        phone: userWithData.phone,
                        status: userWithData.status
                    },
                    role: userWithData.role,
                    companies: [
                        ...userWithData.owned_companies,
                        ...userWithData.assigned_companies
                    ],
                    temporalPassword: password // Solo para desarrollo
                }
            });

        } catch (error) {
            console.error('❌ Error al registrar:', error);

            // Solo hacer rollback si la transacción existe y no ha sido completada
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }

            // Determinar el tipo de error para dar una respuesta más específica
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'El email o teléfono ya están registrados',
                    data: null,
                    error: error.errors.map(e => e.message)
                });
            }

            return res.status(500).json({
                success: false,
                status: 500,
                message: 'Error al crear usuario y compañía',
                data: null,
                error: error.message
            });
        }
    }
};
