const jwt = require('jsonwebtoken');

module.exports = (socket, next) => {
  try {
    // Buscar token en diferentes ubicaciones
    let token = null;

    // 1. En auth (preferido)
    if (socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }

    // 2. En query (fallback)
    if (!token && socket.handshake.query && socket.handshake.query.token) {
      token = socket.handshake.query.token;
    }

    // 3. En headers (otro fallback)
    if (!token && socket.handshake.headers && socket.handshake.headers.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return next(new Error('Token requerido'));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Validar que el payload tenga los campos necesarios
    if (!payload.userId || !payload.companyId) {
      return next(new Error('Token inválido - campos faltantes'));
    }

    socket.userId = payload.userId;
    socket.companyId = payload.companyId;

    return next();
  } catch (err) {
    return next(new Error(`Auth failed: ${err.message}`));
  }
};