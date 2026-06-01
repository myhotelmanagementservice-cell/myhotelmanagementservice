// server/socket/handler.js
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

let ioInstance = null;

module.exports = function setupSocketIO(server) {
  if (ioInstance) return ioInstance;

  // 1️⃣ Initialize Socket.IO Server
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e7 // 10MB for large payloads (images, exports)
  });

  // 2️⃣ Optional: Redis Adapter for Horizontal Scaling
  if (process.env.REDIS_URL) {
    try {
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ Socket.IO Redis adapter initialized');
    } catch (err) {
      console.warn('⚠️ Redis adapter failed, falling back to in-memory:', err.message);
    }
  }

  // 3️⃣ Socket Middleware: Validate & Attach hotelId
  io.use((socket, next) => {
    const { hotelId, clientId } = socket.handshake.auth || {};

    if (!hotelId || typeof hotelId !== 'string' || hotelId.trim() === '') {
      return next(new Error('Missing or invalid hotelId in auth'));
    }

    socket.hotelId = hotelId.trim();
    socket.clientId = clientId || socket.id; // Used for frontend deduplication
    next();
  });

  // 4️⃣ Connection Handler
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id} | Hotel: ${socket.hotelId}`);

    // Auto-join hotel-specific room
    const roomName = `hotel_${socket.hotelId}`;
    socket.join(roomName);
    socket.emit('connected', {
      hotelId: socket.hotelId,
      clientId: socket.clientId,
      message: 'Joined hotel channel'
    });

    // Fallback explicit join
    socket.on('join_hotel', (hotelId) => {
      if (hotelId !== socket.hotelId) {
        return socket.emit('error', { code: 'MISMATCH', message: 'Hotel ID mismatch' });
      }
      socket.join(roomName);
    });

    // 5️⃣ Generic Broadcast Handler (Prevents self-echo, adds sync metadata)
    const handleBroadcast = (eventName, payload) => {
      if (!payload || payload.hotelId !== socket.hotelId) {
        return socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Hotel ID mismatch in payload' });
      }

      const broadcastData = {
        data: payload.data || payload,
        clientId: socket.clientId,
        syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString()
      };

      // Broadcast to ALL clients in this hotel EXCEPT sender
      socket.to(roomName).emit(eventName, broadcastData);
      // console.log(`📡 Broadcast ${eventName} → ${roomName}`);
    };

    // 6️⃣ Register Real-Time Events
    const realTimeEvents = [
      'req_new', 'req_upd',
      'room_upd', 'food_upd', 'inventory_upd',
      'booking_new', 'booking_upd',
      'cfg_upd', 'staff_upd', 'log_added'
    ];

    realTimeEvents.forEach(event => {
      socket.on(event, (payload) => handleBroadcast(event, payload));
    });

    // 7️⃣ Full Sync Acknowledgment
    socket.on('sync_request', () => {
      // Client triggers this on connect/reconnect
      // In a full SaaS, you'd fetch latest DB state here.
      // Frontend handles localStorage fallback if DB is unavailable.
      socket.emit('sync_ack', { hotelId: socket.hotelId });
    });

    // 8️⃣ Disconnect & Error Handlers
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id} | Hotel: ${socket.hotelId} | Reason: ${reason}`);
    });

    socket.on('error', (err) => {
      console.error(`⚠️ Socket error [${socket.hotelId}]:`, err.message);
    });
  });

  ioInstance = io;
  return io;
};
