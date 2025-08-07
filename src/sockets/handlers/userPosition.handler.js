const { user_current_position } = require('../../models');

/**
 * Manejador de eventos de posición de usuario.
 * Se registra desde sockets/index.js.
 */
module.exports = (io, socket) => {
  socket.on('position_update', async ({ lat, lng, accuracy, timestamp }) => {
    try {
      // Validar datos de entrada
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return;
      }

      // Usar timestamp del frontend si está disponible, sino usar fecha del servidor
      const updateTime = timestamp ? new Date(timestamp) : new Date();

      // Actualizar posición en la base de datos
      await user_current_position.update(
        {
          position: { type: 'Point', coordinates: [lng, lat] },
          accuracy: accuracy ?? null,
          updated_at: updateTime,
          last_update_source: 'mobile_app'
        },
        { where: { user_id: socket.userId } }
      );

      // Emitir la actualización a todos los clientes de la compañía
      const positionData = {
        userId: socket.userId,
        lat,
        lng,
        accuracy: accuracy ?? null,
        updatedAt: updateTime.getTime() // Enviar timestamp del frontend como número
      };

      io.to(`company_${socket.companyId}`).emit('position_update', positionData);

      console.log(`📍 Posición actualizada - Usuario: ${socket.userId}, Lat: ${lat}, Lng: ${lng}, Timestamp: ${updateTime.toISOString()}`);
    } catch (err) {
      console.error(`🚨 Error guardando posición del usuario ${socket.userId}:`, err.message);
    }
  });
};