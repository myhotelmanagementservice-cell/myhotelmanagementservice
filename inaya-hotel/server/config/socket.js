const { Server } = require('socket.io');

let io;

function setupSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('join_hotel', (hotelId) => {
      socket.join(`hotel_${hotelId}`);
      console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
      socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
    });

    socket.on('joinHotel', (hotelId) => {
      socket.join(`hotel_${hotelId}`);
      socket.emit('connected', { hotelId, message: 'Connected' });
    });

    // Event forwarding
    const events = [
      'req_new', 'req_upd', 'room_upd', 'guest_upd',
      'food_upd', 'inventory_upd', 'cfg_upd', 'currency_upd',
      'booking_new', 'booking_upd', 'staff_upd', 'review_new'
    ];

    events.forEach(eventName => {
      socket.on(eventName, (payload) => {
        const hotelId = payload?.hotelId;
        if (!hotelId) return;

        const data = {
          ...payload,
          syncToken: payload?.syncToken || Date.now(),
          timestamp: new Date().toISOString()
        };

        io.to(`hotel_${hotelId}`).emit(eventName, data);
        console.log(`📡 Broadcast ${eventName} to hotel_${hotelId}`);
      });
    });

    socket.on('leave_hotel', (hotelId) => {
      socket.leave(`hotel_${hotelId}`);
      console.log(`📡 ${socket.id} left room: hotel_${hotelId}`);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected:', socket.id);
    });

    socket.on('error', (error) => {
      console.error('⚠️ Socket error:', error);
    });
  });

  console.log('✅ Socket.io setup complete');
  return io;
}

function getIO() {
  return io;
}

module.exports = {
  setupSocket,
  getIO
};