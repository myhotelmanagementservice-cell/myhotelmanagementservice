const { Server } = require('socket.io');

let io;

function setupSocket(server) {
  io = new Server(server, {
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

  io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // ========== JOIN ROOMS ==========

    // Join hotel-wide room
    socket.on('join_hotel', (hotelId) => {
      socket.join(`hotel_${hotelId}`);
      console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
      socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
    });

    // Alternative join method (backward compatibility)
    socket.on('joinHotel', (hotelId) => {
      socket.join(`hotel_${hotelId}`);
      socket.emit('connected', { hotelId, message: 'Connected' });
    });

    // Admin joins dedicated admin room
    socket.on('join_admin', (hotelId) => {
      socket.join(`hotel_${hotelId}`);
      socket.join(`admin_${hotelId}`);
      console.log(`👑 Admin ${socket.id} joined admin room: admin_${hotelId}`);
      socket.emit('admin_connected', { hotelId, message: 'Connected to admin channel' });

      // Notify admin about online count
      const roomClients = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
      socket.emit('online_count', { count: roomClients ? roomClients.size : 0 });
    });

    // Guest joins hotel room + specific room channel
    socket.on('join_guest', ({ hotelId, roomNumber, guestName }) => {
      socket.join(`hotel_${hotelId}`);
      socket.join(`guest_${hotelId}`);
      if (roomNumber) {
        socket.join(`room_${hotelId}_${roomNumber}`);
      }
      socket.hotelId = hotelId;
      socket.roomNumber = roomNumber;
      socket.guestName = guestName;
      console.log(`🏨 Guest ${guestName || 'Unknown'} (Room ${roomNumber}) joined hotel_${hotelId}`);
      socket.emit('guest_connected', { hotelId, roomNumber, message: 'Connected to hotel services' });

      // Notify admins that a guest connected
      io.to(`admin_${hotelId}`).emit('guest_online', {
        hotelId,
        roomNumber,
        guestName,
        timestamp: new Date().toISOString()
      });
    });

    // ========== EVENT FORWARDING - HOTEL WIDE ==========

    const hotelWideEvents = [
      'req_new', 'req_upd', 'room_upd', 'guest_upd',
      'food_upd', 'inventory_upd', 'cfg_upd', 'currency_upd',
      'booking_new', 'booking_upd', 'staff_upd', 'review_new',
      'announcement_upd', 'policy_upd', 'blacklist_upd',
      'maintenance_upd', 'logs_upd', 'dept_upd'
    ];

    hotelWideEvents.forEach(eventName => {
      socket.on(eventName, (payload) => {
        const hotelId = payload?.hotelId;
        if (!hotelId) return;

        const data = {
          ...payload,
          syncToken: payload?.syncToken || Date.now(),
          timestamp: new Date().toISOString()
        };

        // Broadcast to all hotel devices
        io.to(`hotel_${hotelId}`).emit(eventName, data);

        // Special handling for specific events
        if (eventName === 'req_new' && payload.priority === 'emergency') {
          // Emergency requests go specifically to admins
          io.to(`admin_${hotelId}`).emit('emergency_request', data);
        }

        if (eventName === 'announcement_upd') {
          // Announcements go to guests
          io.to(`guest_${hotelId}`).emit('new_announcement', data);
        }

        if (eventName === 'policy_upd') {
          // Policies go to guests
          io.to(`guest_${hotelId}`).emit('policy_updated', data);
        }

        if (eventName === 'food_upd') {
          // Menu updates go to guests
          io.to(`guest_${hotelId}`).emit('menu_updated', data);
        }

        console.log(`📡 Broadcast ${eventName} to hotel_${hotelId}`);
      });
    });

    // ========== ADMIN ↔ GUEST COMMUNICATION ==========

    // Guest sends action to admin
    socket.on('guest_action', (payload) => {
      const hotelId = payload?.hotelId;
      if (!hotelId) return;

      broadcastToAdmins(hotelId, 'guest_action', {
        ...payload,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });

      // Also broadcast hotel-wide for sync
      io.to(`hotel_${hotelId}`).emit('guest_action', {
        ...payload,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
    });

    // Admin sends action to specific guest room
    socket.on('admin_action', (payload) => {
      const hotelId = payload?.hotelId;
      if (!hotelId) return;

      broadcastToGuests(hotelId, 'admin_action', {
        ...payload,
        timestamp: new Date().toISOString()
      });

      // Also broadcast hotel-wide so all admin tabs sync
      io.to(`admin_${hotelId}`).emit('admin_action_ack', { 
        ...payload, 
        timestamp: new Date().toISOString() 
      });
    });

    // Admin replies to a guest request - target specific room
    socket.on('admin_reply', (payload) => {
      const { hotelId, roomNumber } = payload;
      if (!hotelId) return;

      if (roomNumber) {
        io.to(`room_${hotelId}_${roomNumber}`).emit('admin_reply', {
          ...payload,
          timestamp: new Date().toISOString()
        });
      }

      // Also notify all guests
      io.to(`guest_${hotelId}`).emit('request_updated', payload);

      // And sync to admins
      io.to(`admin_${hotelId}`).emit('req_upd', payload);
    });

    // ========== FULL SYNC ==========

    // Request full data sync
    socket.on('sync_all', (payload) => {
      const hotelId = payload?.hotelId;
      if (!hotelId) return;

      // This will be handled by the server to send full data
      socket.emit('sync_all', {
        hotelId,
        syncToken: Date.now(),
        timestamp: new Date().toISOString()
      });
    });

    // ========== LEAVE ROOMS ==========

    socket.on('leave_hotel', (hotelId) => {
      socket.leave(`hotel_${hotelId}`);
      socket.leave(`admin_${hotelId}`);
      socket.leave(`guest_${hotelId}`);
      if (socket.roomNumber) {
        socket.leave(`room_${hotelId}_${socket.roomNumber}`);
      }
      console.log(`📡 ${socket.id} left room: hotel_${hotelId}`);
    });

    // ========== ONLINE COUNT ==========

    socket.on('get_online_count', (hotelId) => {
      const roomClients = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
      socket.emit('online_count', { count: roomClients ? roomClients.size : 0 });
    });

    // ========== DISCONNECT ==========

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected:', socket.id);

      // Notify admin when guest disconnects
      if (socket.hotelId && socket.roomNumber) {
        io.to(`admin_${socket.hotelId}`).emit('guest_offline', {
          hotelId: socket.hotelId,
          roomNumber: socket.roomNumber,
          guestName: socket.guestName,
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('error', (error) => {
      console.error('⚠️ Socket error:', error);
    });
  });

  console.log('✅ Socket.io setup complete');
  return io;
}

// ========== HELPER FUNCTIONS ==========

// Broadcast to all admins of a hotel
function broadcastToAdmins(hotelId, eventName, payload) {
  if (!io) return;
  const data = { 
    ...payload, 
    syncToken: Date.now(), 
    timestamp: new Date().toISOString() 
  };
  io.to(`admin_${hotelId}`).emit(eventName, data);
}

// Broadcast to all guests of a hotel
function broadcastToGuests(hotelId, eventName, payload) {
  if (!io) return;
  const data = { 
    ...payload, 
    syncToken: Date.now(), 
    timestamp: new Date().toISOString() 
  };
  io.to(`guest_${hotelId}`).emit(eventName, data);

  // Also send to specific room if roomNumber present
  if (payload?.roomNumber) {
    io.to(`room_${hotelId}_${payload.roomNumber}`).emit(eventName, data);
  }
}

// Broadcast to specific guest room
function broadcastToRoom(hotelId, roomNumber, eventName, payload) {
  if (!io) return;
  const data = { 
    ...payload, 
    syncToken: Date.now(), 
    timestamp: new Date().toISOString() 
  };
  io.to(`room_${hotelId}_${roomNumber}`).emit(eventName, data);
}

// Get IO instance
function getIO() {
  return io;
}

module.exports = {
  setupSocket,
  getIO,
  broadcastToAdmins,
  broadcastToGuests,
  broadcastToRoom
};