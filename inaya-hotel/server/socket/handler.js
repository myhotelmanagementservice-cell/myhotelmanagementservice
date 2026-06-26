// server/socket/handler.js
// Complete Socket.IO Handler for Multi-Tenant Hotel SaaS
// Compatible with frontend index.html

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
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e7, // 10MB for large payloads
    allowEIO3: true // backward compatibility
  });

  // 2️⃣ Optional: Redis Adapter for Horizontal Scaling
  if (process.env.REDIS_URL) {
    try {
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();

      pubClient.on('error', err => console.error('Redis Pub Client Error:', err));
      subClient.on('error', err => console.error('Redis Sub Client Error:', err));

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
    socket.clientId = clientId || socket.id;
    next();
  });

  // 4️⃣ Connection Handler
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id} | Hotel: ${socket.hotelId}`);

    // Auto-join hotel-wide room
    const hotelRoom = `hotel_${socket.hotelId}`;
    socket.join(hotelRoom);

    socket.emit('connected', {
      hotelId: socket.hotelId,
      clientId: socket.clientId,
      message: 'Connected to hotel channel'
    });

    // ========== JOIN ROOMS ==========

    // Join hotel room (fallback)
    socket.on('join_hotel', (hotelId) => {
      if (hotelId && hotelId !== socket.hotelId) {
        return socket.emit('error', { code: 'MISMATCH', message: 'Hotel ID mismatch' });
      }
      socket.join(hotelRoom);
      socket.emit('connected', { hotelId: socket.hotelId, message: 'Connected' });
    });

    // ✅ Join admin-specific room
    socket.on('join_admin', (hotelId) => {
      const targetHotel = hotelId || socket.hotelId;
      socket.join(`hotel_${targetHotel}`);
      socket.join(`admin_${targetHotel}`);
      socket.isAdmin = true;
      console.log(`👑 Admin ${socket.id} joined admin_${targetHotel}`);

      socket.emit('admin_connected', { 
        hotelId: targetHotel, 
        message: 'Connected to admin channel' 
      });

      // Send online count
      const roomClients = io.sockets.adapter.rooms.get(`hotel_${targetHotel}`);
      socket.emit('online_count', { 
        count: roomClients ? roomClients.size : 0 
      });

      // Notify other admins
      socket.to(`admin_${targetHotel}`).emit('admin_online', {
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Join guest-specific room (hotel + guest + room-specific)
    socket.on('join_guest', ({ hotelId, roomNumber, guestName }) => {
      const targetHotel = hotelId || socket.hotelId;
      socket.join(`hotel_${targetHotel}`);
      socket.join(`guest_${targetHotel}`);

      if (roomNumber) {
        socket.join(`room_${targetHotel}_${roomNumber}`);
      }

      socket.isGuest = true;
      socket.roomNumber = roomNumber;
      socket.guestName = guestName;

      console.log(`🏨 Guest ${guestName || 'Unknown'} (Room ${roomNumber}) joined hotel_${targetHotel}`);

      socket.emit('guest_connected', { 
        hotelId: targetHotel, 
        roomNumber, 
        message: 'Connected to hotel services' 
      });

      // Notify admins that a guest connected
      io.to(`admin_${targetHotel}`).emit('guest_online', {
        hotelId: targetHotel,
        roomNumber,
        guestName,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
    });

    // ========== LEAVE ROOMS ==========

    socket.on('leave_hotel', (hotelId) => {
      const targetHotel = hotelId || socket.hotelId;
      socket.leave(`hotel_${targetHotel}`);
      socket.leave(`admin_${targetHotel}`);
      socket.leave(`guest_${targetHotel}`);
      if (socket.roomNumber) {
        socket.leave(`room_${targetHotel}_${socket.roomNumber}`);
      }
      console.log(`📡 ${socket.id} left hotel_${targetHotel}`);
    });

    // ========== ONLINE COUNT ==========

    socket.on('get_online_count', (hotelId) => {
      const targetHotel = hotelId || socket.hotelId;
      const roomClients = io.sockets.adapter.rooms.get(`hotel_${targetHotel}`);
      socket.emit('online_count', { 
        count: roomClients ? roomClients.size : 0,
        hotelId: targetHotel
      });
    });

    // ========== GENERIC BROADCAST HANDLER ==========

    const handleBroadcast = (eventName, payload) => {
      if (!payload) return;

      const payloadHotelId = payload.hotelId || payload.data?.hotelId;
      if (payloadHotelId && payloadHotelId !== socket.hotelId) {
        return socket.emit('error', { 
          code: 'INVALID_PAYLOAD', 
          message: 'Hotel ID mismatch in payload' 
        });
      }

      const broadcastData = {
        data: payload.data || payload,
        hotelId: socket.hotelId,
        clientId: socket.clientId,
        syncToken: payload.syncToken || `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString()
      };

      // Broadcast to ALL clients in this hotel (including sender for consistency)
      io.to(hotelRoom).emit(eventName, broadcastData);
    };

    // ========== CORE CRUD EVENTS ==========

    const coreEvents = [
      'req_new', 'req_upd',
      'room_upd', 'food_upd', 'inventory_upd',
      'booking_new', 'booking_upd',
      'cfg_upd', 'currency_upd',
      'staff_upd', 'review_new',
      'blacklist_upd', 'maintenance_upd',
      'logs_upd', 'dept_upd',
      'policy_upd', 'announcement_upd',
      'guest_upd'
    ];

    coreEvents.forEach(event => {
      socket.on(event, (payload) => handleBroadcast(event, payload));
    });

    // ========== SPECIAL EVENT HANDLERS ==========

    // ✅ New request - also notify admins specifically
    socket.on('req_new', (payload) => {
      handleBroadcast('req_new', payload);

      // Special notification to admins
      const reqData = payload.data || payload;
      if (reqData.priority === 'emergency') {
        io.to(`admin_${socket.hotelId}`).emit('emergency_request', {
          data: reqData,
          hotelId: socket.hotelId,
          timestamp: new Date().toISOString()
        });
      }

      io.to(`admin_${socket.hotelId}`).emit('new_guest_request', {
        data: reqData,
        hotelId: socket.hotelId,
        syncToken: Date.now(),
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Food update - notify guests about menu change
    socket.on('food_upd', (payload) => {
      handleBroadcast('food_upd', payload);
      io.to(`guest_${socket.hotelId}`).emit('menu_updated', {
        data: payload.data || payload,
        hotelId: socket.hotelId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Policy update - notify guests
    socket.on('policy_upd', (payload) => {
      handleBroadcast('policy_upd', payload);
      io.to(`guest_${socket.hotelId}`).emit('policy_updated', {
        data: payload.data || payload,
        hotelId: socket.hotelId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Announcement update - notify guests
    socket.on('announcement_upd', (payload) => {
      handleBroadcast('announcement_upd', payload);
      io.to(`guest_${socket.hotelId}`).emit('new_announcement', {
        data: payload.data || payload,
        hotelId: socket.hotelId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Review new - notify admins
    socket.on('review_new', (payload) => {
      handleBroadcast('review_new', payload);
      io.to(`admin_${socket.hotelId}`).emit('new_guest_review', {
        data: payload.data || payload,
        hotelId: socket.hotelId,
        timestamp: new Date().toISOString()
      });
    });

    // ========== BIDIRECTIONAL COMMUNICATION ==========

    // ✅ Guest action → Admins
    socket.on('guest_action', (payload) => {
      if (!payload) return;

      const broadcastData = {
        ...payload,
        socketId: socket.id,
        hotelId: socket.hotelId,
        syncToken: payload.syncToken || Date.now(),
        timestamp: new Date().toISOString()
      };

      // Send to admins
      io.to(`admin_${socket.hotelId}`).emit('guest_action', broadcastData);

      // Also broadcast hotel-wide for sync
      io.to(hotelRoom).emit('guest_action', broadcastData);
    });

    // ✅ Admin action → Guests
    socket.on('admin_action', (payload) => {
      if (!payload) return;

      const broadcastData = {
        ...payload,
        hotelId: socket.hotelId,
        syncToken: payload.syncToken || Date.now(),
        timestamp: new Date().toISOString()
      };

      // Send to guests
      io.to(`guest_${socket.hotelId}`).emit('admin_action', broadcastData);

      // If roomNumber specified, send to that specific room
      if (payload.roomNumber) {
        io.to(`room_${socket.hotelId}_${payload.roomNumber}`).emit('admin_action', broadcastData);
      }

      // Acknowledge to other admins
      socket.to(`admin_${socket.hotelId}`).emit('admin_action_ack', broadcastData);
    });

    // ✅ Admin reply to guest request
    socket.on('admin_reply', (payload) => {
      if (!payload) return;

      const { hotelId, roomNumber, requestId, reply, status } = payload;
      const targetHotel = hotelId || socket.hotelId;

      const broadcastData = {
        ...payload,
        hotelId: targetHotel,
        timestamp: new Date().toISOString()
      };

      // Send to specific guest room
      if (roomNumber) {
        io.to(`room_${targetHotel}_${roomNumber}`).emit('admin_reply', broadcastData);
      }

      // Notify all guests about request update
      io.to(`guest_${targetHotel}`).emit('request_updated', broadcastData);

      // Sync to other admins
      io.to(`admin_${targetHotel}`).emit('req_upd', {
        data: payload.data || payload,
        hotelId: targetHotel,
        syncToken: Date.now(),
        timestamp: new Date().toISOString()
      });

      // Hotel-wide sync
      io.to(`hotel_${targetHotel}`).emit('req_upd', {
        data: payload.data || payload,
        hotelId: targetHotel,
        syncToken: Date.now(),
        timestamp: new Date().toISOString()
      });
    });

    // ========== FULL SYNC ==========

    socket.on('sync_request', () => {
      socket.emit('sync_ack', { 
        hotelId: socket.hotelId,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('sync_all', (payload) => {
      const targetHotel = payload?.hotelId || socket.hotelId;
      socket.emit('sync_all', {
        hotelId: targetHotel,
        syncToken: Date.now(),
        timestamp: new Date().toISOString()
      });
    });

    // ========== DISCONNECT ==========

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id} | Hotel: ${socket.hotelId} | Reason: ${reason}`);

      // Notify admins if guest disconnects
      if (socket.isGuest && socket.roomNumber) {
        io.to(`admin_${socket.hotelId}`).emit('guest_offline', {
          hotelId: socket.hotelId,
          roomNumber: socket.roomNumber,
          guestName: socket.guestName,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('error', (err) => {
      console.error(`⚠️ Socket error [${socket.hotelId}]:`, err.message);
    });
  });

  // ========== HELPER FUNCTIONS (Export for use in routes) ==========

  // Broadcast to specific hotel
  io.broadcastToHotel = (hotelId, event, data) => {
    io.to(`hotel_${hotelId}`).emit(event, {
      data,
      hotelId,
      syncToken: Date.now(),
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast to admins only
  io.broadcastToAdmins = (hotelId, event, data) => {
    io.to(`admin_${hotelId}`).emit(event, {
      data,
      hotelId,
      syncToken: Date.now(),
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast to guests only
  io.broadcastToGuests = (hotelId, event, data) => {
    io.to(`guest_${hotelId}`).emit(event, {
      data,
      hotelId,
      syncToken: Date.now(),
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast to specific room
  io.broadcastToRoom = (hotelId, roomNumber, event, data) => {
    io.to(`room_${hotelId}_${roomNumber}`).emit(event, {
      data,
      hotelId,
      roomNumber,
      syncToken: Date.now(),
      timestamp: new Date().toISOString()
    });
  };

  ioInstance = io;
  console.log('✅ Socket.IO setup complete with full event support');
  return io;
};