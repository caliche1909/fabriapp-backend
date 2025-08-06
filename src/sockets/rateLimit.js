// sockets/rateLimit.js
// Middleware muy simple de rate-limit para eventos Socket.IO.
// Permite MAX_EMITS eventos cada WINDOW ms por socket.
// Si se supera, se interrumpe con un Error.

const WINDOW = 5000;      // 5 segundos
const MAX_EMITS = 20;      // eventos permitidos en la ventana

const buckets = new Map();

module.exports = function (packet, next) {
  const now = Date.now();
  const key = this.id; // «this» es el socket

  let bucket = buckets.get(key) || [];
  bucket = bucket.filter(ts => now - ts < WINDOW);
  bucket.push(now);
  buckets.set(key, bucket);

  if (bucket.length > MAX_EMITS) {
    return next(new Error('Limite de actualizaciones alcanzado'));
  }
  next();
};