const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    let token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ message: "No existe un token" });
    }

    token = token.split(" ")[1];

    try {
        const { email, role_id } = jwt.verify(token, process.env.JWT_SECRET);
        req.email = email;
        req.role_id = role_id;

        next();


    } catch (error) {

    }
};

const verifySuperAdmin = (req, res, next) => {
    if (req.role_id === 1) {
        return next();

    }
    return res.status(403).json({ message: "Acceso denegado" });
};

const verifyAdmin = (req, res, next) => {
    if (req.role_id === 1 || req.role_id === 2) {
        return next();

    }
    return res.status(403).json({ message: "Acceso denegado" });
};


// 📌 Exportar las funciones correctamente
module.exports = {
    verifyToken,
    verifyAdmin,
    verifySuperAdmin
};