const { getIO } = require('../config/socket');

// Broadcast to hotel room
const broadcast = (hotelId, event, data, clientId = null) => {
  const io = getIO();
  if (!io) return;

  const payload = {
    data,
    hotelId,
    clientId,
    syncToken: Date.now()
  };

  io.to(`hotel_${hotelId}`).emit(event, payload);
  console.log(`📡 Broadcast ${event} to hotel_${hotelId}`);
};

module.exports = {
  broadcast
};