const { users, roles } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { and } = require('sequelize');

const SALT_ROUNDS = 10;
const SECRET_KEY = process.env.JWT_SECRET;

module.exports = {

    // 📌 LOGIN DE USUARIO
    async login(req, res) {
        try {
            const { email, password } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Ingrese su correo electronico" });
            } else if (!password) {
                return res.status(400).json({ message: "Ingrese su contraseña" });
            }

            const userForLogin = await users.findOne({ where: { email } });
            if (!userForLogin) {
                return res.status(404).json({ message: "El usuario ingresado NO EXISTE!" });
            }

            const passwordMatch = await bcrypt.compare(password, userForLogin.password);
            if (!passwordMatch) {
                return res.status(400).json({ message: "Contraseña incorrecta" });
            }

            // **🔹 Generar el token JWT**
            const token = jwt.sign({ id: userForLogin.id, email: userForLogin.email, role_id: userForLogin.role_id }, SECRET_KEY, { expiresIn: '8h' });

            const user = {
                id: userForLogin.id,
                email: userForLogin.email,
                name: userForLogin.name,
                role_id: userForLogin.role_id,
                phone: userForLogin.phone
            };

            res.status(200).json({ message: "Login exitoso", token, user });

        } catch (error) {
            console.error("❌ Error en login:", error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // 📌 REGISTRAR USUARIO + Token Automático
    async register(req, res) {
        try {
            const { password, email, name, role_id, phone } = req.body;

            // Validaciones
            if (!password || !email || !name || !role_id || !phone) {
                return res.status(400).json({ message: "Todos los campos son obligatorios" });
            }

            // Verificar si el role_id existe
            const roleExists = await roles.findByPk(role_id);
            if (!roleExists) {
                return res.status(400).json({ message: "El role_id proporcionado no existe" });
            }

            // Verificar si el usuario ya existe
            const userExists = await users.findOne({ where: { email } });
            if (userExists) {
                return res.status(400).json({ message: "El email proporcionado ya está en uso" });
            }

            // Hashear la contraseña
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

            // Crear usuario
            const newUser = await users.create({
                password: hashedPassword,
                email,
                name,
                role_id,
                phone
            });

            // **🔹 Generar un token JWT al registrarse**
            const token = jwt.sign({ id: newUser.id, email: newUser.email, role_id: newUser.role_id }, SECRET_KEY, { expiresIn: '8h' });

            console.log("✅ Usuario creado:", newUser);

            const userWithoutPassword = {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                role_id: newUser.role_id,
                phone: newUser.phone
            };

            res.status(201).json({ message: "Usuario registrado exitosamente", token, user: userWithoutPassword });

        } catch (error) {
            console.error("❌ Error en register:", error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // 📌 Obtener todos los usuarios
    async list(req, res) {
        console.log("📌 Llegó a la función list");
        try {
            const allUsers = await users.findAll();
            res.status(200).json(allUsers);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 Obtener todos los usuarios de tipo vendedor
    async getSellers(req, res) {
        try {
            const roleId = 3; // Rol de Vendedor

            const usersByRole = await users.findAll({
                where: { role_id: roleId, status: "active" }, // Solo obtener los vendedores activos
                attributes: ["id", "email", "name", "phone", "status"], // Solo obtener estos campos
                include: [
                    {
                        model: roles,
                        as: "role",
                        attributes: ["id", "name"] // Solo obtener el id y el nombre del rol
                    }
                ]
            });

            if (!usersByRole.length) {
                return res.status(404).json({ message: "No hay vendedores" });
            }

            res.status(200).json(usersByRole);
        } catch (error) {
            console.error("❌ Error al obtener vendedores:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // 📌 Obtener un usuario por ID
    async getById(req, res) {
        try {
            const { id } = req.params;
            const user = await users.findByPk(id);

            if (!user) {
                return res.status(404).json({ message: "Usuario no encontrado" });
            }

            res.status(200).json(user);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 Crear un usuario
    async create(req, res) {
        try {
            console.log("➡️ POST /api/users - Datos recibidos:", req.body);

            if (!req.body || Object.keys(req.body).length === 0) {
                console.log("⚠️ El body está vacío");
                return res.status(400).json({ message: "El cuerpo de la solicitud no puede estar vacío" });
            }

            const { password, email, name, role_id, phone } = req.body;

            const roleExists = await roles.findByPk(role_id);
            if (!roleExists) {
                return res.status(400).json({ message: "El role_id proporcionado no existe" });
            }

            // Hashear la contraseña antes de guardar
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

            const newUser = await users.create({
                password: hashedPassword,
                email,
                name,
                role_id,
                phone
            });

            console.log("✅ Usuario creado:", newUser);
            res.status(201).json(newUser);
        } catch (error) {
            console.error("❌ Error en createUser:", error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // 📌 Actualizar un usuario por ID
    async update(req, res) {
        try {
            const { id } = req.params;
            const { password, email, name, role_id, phone } = req.body;

            const user = await users.findByPk(id);
            if (!user) {
                return res.status(404).json({ message: "Usuario no encontrado" });
            }

            // Si la contraseña es proporcionada, la hasheamos
            let updatedFields = { email, name, role_id, phone };
            if (password) {
                updatedFields.password = await bcrypt.hash(password, SALT_ROUNDS);
            }

            await user.update(updatedFields);
            res.status(200).json(user);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    // 📌 Eliminar un usuario por ID
    async delete(req, res) {
        try {
            const { id } = req.params;

            const user = await users.findByPk(id);
            if (!user) {
                return res.status(404).json({ message: "Usuario no encontrado" });
            }

            await user.destroy();
            res.status(200).json({ message: "Usuario eliminado correctamente" });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
};

