// server/utils/broadcast.js
// Complete Broadcast System for Multi-Tenant Hotel SaaS
// Compatible with index.html (19 admin pages + 9 guest pages)
// Supports: Real-time sync, Live broadcast, Bidirectional communication

const { getIO } = require('../config/socket');

// ============================================================
// CORE BROADCAST FUNCTIONS
// ============================================================

/**
 * Broadcast to entire hotel (all devices - admin + guest)
 * @param {string} hotelId - Hotel ID
 * @param {string} event - Event name
 * @param {Object} data - Data to broadcast
 * @param {string} clientId - Client ID (for deduplication)
 * @param {string} action - Action type: 'create' | 'update' | 'delete'
 */
const broadcast = (hotelId, event, data, clientId = null, action = 'update') => {
  const io = getIO();
  if (!io || !hotelId) return;

  const payload = {
    data,
    hotelId,
    clientId,
    action,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`hotel_${hotelId}`).emit(event, payload);
  console.log(`📡 [${hotelId}] ${event} → hotel room (action: ${action})`);
};

/**
 * Broadcast to admin devices only
 */
const broadcastToAdmins = (hotelId, event, data, clientId = null, action = 'update') => {
  const io = getIO();
  if (!io || !hotelId) return;

  const payload = {
    data,
    hotelId,
    clientId,
    action,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`admin_${hotelId}`).emit(event, payload);
  console.log(`👑 [${hotelId}] ${event} → admin room (action: ${action})`);
};

/**
 * Broadcast to guest devices only
 */
const broadcastToGuests = (hotelId, event, data, clientId = null, action = 'update') => {
  const io = getIO();
  if (!io || !hotelId) return;

  const payload = {
    data,
    hotelId,
    clientId,
    action,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`guest_${hotelId}`).emit(event, payload);
  console.log(`🏨 [${hotelId}] ${event} → guest room (action: ${action})`);
};

/**
 * Broadcast to specific guest room
 */
const broadcastToRoom = (hotelId, roomNumber, event, data, clientId = null, action = 'update') => {
  const io = getIO();
  if (!io || !hotelId || !roomNumber) return;

  const payload = {
    data,
    hotelId,
    roomNumber,
    clientId,
    action,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`room_${hotelId}_${roomNumber}`).emit(event, payload);
  console.log(`🚪 [${hotelId}] ${event} → room #${roomNumber} (action: ${action})`);
};

// ============================================================
// EVENT-SPECIFIC BROADCAST HELPERS
// ============================================================

/**
 * Broadcast new guest request to admins
 * Used by: Requests page (admin)
 */
const broadcastNewRequest = (hotelId, request, clientId = null) => {
  // Hotel-wide broadcast
  broadcast(hotelId, 'req_new', request, clientId, 'create');

  // Special notification to admins
  broadcastToAdmins(hotelId, 'new_guest_request', request, clientId, 'create');

  // Emergency alert if priority is emergency
  if (request.priority === 'emergency') {
    broadcastToAdmins(hotelId, 'emergency_request', request, clientId, 'create');
  }
};

/**
 * Broadcast request update
 * Used by: Requests page (admin + guest)
 */
const broadcastRequestUpdate = (hotelId, request, clientId = null, action = 'update') => {
  broadcast(hotelId, 'req_upd', request, clientId, action);

  // Notify specific guest room if admin reply
  if (request.adminReply && request.roomNumber) {
    broadcastToRoom(hotelId, request.roomNumber, 'admin_reply', {
      requestId: request._id,
      reply: request.adminReply,
      status: request.status,
      adminReplyTime: request.adminReplyTime
    }, clientId, action);
  }

  // Notify all guests about request update
  broadcastToGuests(hotelId, 'request_updated', request, clientId, action);
};

/**
 * Broadcast room update
 * Used by: Rooms page (admin), Guest dashboard
 */
const broadcastRoomUpdate = (hotelId, room, clientId = null, action = 'update') => {
  broadcast(hotelId, 'room_upd', room, clientId, action);

  // Notify specific room about status change
  if (room.number && room.status) {
    broadcastToRoom(hotelId, room.number, 'room_status_changed', {
      number: room.number,
      status: room.status,
      guestName: room.guestName
    }, clientId, action);
  }
};

/**
 * Broadcast guest update
 * Used by: Guests page (admin), Loyalty page
 */
const broadcastGuestUpdate = (hotelId, guest, clientId = null, action = 'update') => {
  broadcast(hotelId, 'guest_upd', guest, clientId, action);

  // Notify specific room about check-in
  if (action === 'create' && guest.room) {
    broadcastToRoom(hotelId, guest.room, 'guest_checkedin', guest, clientId, action);
  }
};

/**
 * Broadcast food/menu update
 * Used by: Food page (admin), Guest food ordering
 */
const broadcastFoodUpdate = (hotelId, foodItem, clientId = null, action = 'update') => {
  broadcast(hotelId, 'food_upd', foodItem, clientId, action);

  // Notify guests about menu update
  broadcastToGuests(hotelId, 'menu_updated', foodItem, clientId, action);
};

/**
 * Broadcast inventory update
 * Used by: Inventory page (admin), Guest inventory requests
 */
const broadcastInventoryUpdate = (hotelId, item, clientId = null, action = 'update') => {
  broadcast(hotelId, 'inventory_upd', item, clientId, action);
};

/**
 * Broadcast booking update
 * Used by: Bookings page (admin), Guest booking
 */
const broadcastBookingUpdate = (hotelId, booking, clientId = null, action = 'update') => {
  broadcast(hotelId, 'booking_upd', booking, clientId, action);

  // Notify specific room about booking confirmation
  if (action === 'create' && booking.roomNumber) {
    broadcastToRoom(hotelId, booking.roomNumber, 'booking_confirmed', booking, clientId, action);
  }

  // Notify about status change
  if (booking.status && booking.roomNumber) {
    broadcastToRoom(hotelId, booking.roomNumber, 'booking_status_changed', booking, clientId, action);
  }
};

/**
 * Broadcast staff update
 * Used by: Staff page (admin)
 */
const broadcastStaffUpdate = (hotelId, staff, clientId = null, action = 'update') => {
  broadcast(hotelId, 'staff_upd', staff, clientId, action);
};

/**
 * Broadcast new review
 * Used by: Reviews page (admin), Guest rating
 */
const broadcastNewReview = (hotelId, review, clientId = null) => {
  broadcast(hotelId, 'review_new', review, clientId, 'create');

  // Notify admins about new review
  broadcastToAdmins(hotelId, 'new_guest_review', review, clientId, 'create');
};

/**
 * Broadcast config/settings update
 * Used by: Settings page (admin)
 */
const broadcastConfigUpdate = (hotelId, config, clientId = null) => {
  broadcast(hotelId, 'cfg_upd', config, clientId, 'update');

  // Notify guests about settings change (wifi, language, etc.)
  broadcastToGuests(hotelId, 'settings_updated', {
    language: config.language,
    currencySymbol: config.currencySymbol,
    hotelName: config.name,
    wifi: config.wifi
  }, clientId, 'update');
};

/**
 * Broadcast policy update
 * Used by: Policies page (admin), Guest policies
 */
const broadcastPolicyUpdate = (hotelId, policy, clientId = null, action = 'update') => {
  broadcast(hotelId, 'policy_upd', policy, clientId, action);

  // Notify guests about policy update
  broadcastToGuests(hotelId, 'policy_updated', policy, clientId, action);

  if (action === 'delete') {
    broadcastToGuests(hotelId, 'policy_deleted', policy, clientId, action);
  }
};

/**
 * Broadcast announcement update
 * Used by: Announcements page (admin), Guest announcements
 */
const broadcastAnnouncementUpdate = (hotelId, announcement, clientId = null, action = 'update') => {
  broadcast(hotelId, 'announcement_upd', announcement, clientId, action);

  // Notify guests about new announcement
  if (action === 'create' || announcement.isActive) {
    broadcastToGuests(hotelId, 'new_announcement', announcement, clientId, action);
  }

  if (action === 'delete') {
    broadcastToGuests(hotelId, 'announcement_deleted', announcement, clientId, action);
  }
};

/**
 * Broadcast department update
 * Used by: Departments page (admin)
 */
const broadcastDepartmentUpdate = (hotelId, department, clientId = null, action = 'update') => {
  broadcast(hotelId, 'dept_upd', department, clientId, action);
};

/**
 * Broadcast blacklist update
 * Used by: Blacklist page (admin)
 */
const broadcastBlacklistUpdate = (hotelId, entry, clientId = null, action = 'update') => {
  broadcast(hotelId, 'blacklist_upd', entry, clientId, action);
};

/**
 * Broadcast maintenance update
 * Used by: Maintenance page (admin)
 */
const broadcastMaintenanceUpdate = (hotelId, task, clientId = null, action = 'update') => {
  broadcast(hotelId, 'maintenance_upd', task, clientId, action);
};

/**
 * Broadcast logs update
 * Used by: Logs page (admin)
 */
const broadcastLogsUpdate = (hotelId, log, clientId = null, action = 'update') => {
  broadcast(hotelId, 'logs_upd', log, clientId, action);
};

/**
 * Broadcast currency update
 * Used by: Settings page (admin)
 */
const broadcastCurrencyUpdate = (hotelId, currencies, clientId = null) => {
  broadcast(hotelId, 'currency_upd', { currencies }, clientId, 'update');
};

// ============================================================
// GUEST ↔ ADMIN COMMUNICATION
// ============================================================

/**
 * Broadcast guest action to admins
 * Used by: Guest dashboard actions
 */
const broadcastGuestAction = (hotelId, action, data, clientId = null) => {
  const io = getIO();
  if (!io || !hotelId) return;

  const payload = {
    type: action,
    collection: data.collection || action.replace('_new', 's').replace('_upd', 's'),
    data: data.data || data,
    hotelId,
    clientId,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`admin_${hotelId}`).emit('guest_action', payload);
  io.to(`hotel_${hotelId}`).emit('guest_action', payload);

  console.log(`🏨→👑 [${hotelId}] Guest action: ${action}`);
};

/**
 * Broadcast admin action to guests
 * Used by: Admin dashboard actions
 */
const broadcastAdminAction = (hotelId, action, data, clientId = null) => {
  const io = getIO();
  if (!io || !hotelId) return;

  const payload = {
    type: action,
    collection: data.collection || action.replace('_new', 's').replace('_upd', 's'),
    data: data.data || data,
    hotelId,
    clientId,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  };

  io.to(`guest_${hotelId}`).emit('admin_action', payload);

  // If roomNumber specified, send to that specific room
  if (data.roomNumber) {
    io.to(`room_${hotelId}_${data.roomNumber}`).emit('admin_action', payload);
  }

  // Acknowledge to other admins
  io.to(`admin_${hotelId}`).emit('admin_action_ack', payload);

  console.log(`👑→🏨 [${hotelId}] Admin action: ${action}`);
};

/**
 * Broadcast admin reply to specific guest
 * Used by: Requests page (admin reply)
 */
const broadcastAdminReply = (hotelId, roomNumber, replyData, clientId = null) => {
  const io = getIO();
  if (!io || !hotelId || !roomNumber) return;

  const payload = {
    ...replyData,
    hotelId,
    roomNumber,
    clientId,
    timestamp: new Date().toISOString()
  };

  io.to(`room_${hotelId}_${roomNumber}`).emit('admin_reply', payload);
  io.to(`guest_${hotelId}`).emit('request_updated', payload);
  io.to(`admin_${hotelId}`).emit('req_upd', payload);

  console.log(`👑→🏨 [${hotelId}] Admin reply to room #${roomNumber}`);
};

// ============================================================
// ONLINE/OFFLINE STATUS
// ============================================================

/**
 * Broadcast guest online status
 */
const broadcastGuestOnline = (hotelId, guestInfo) => {
  const io = getIO();
  if (!io || !hotelId) return;

  io.to(`admin_${hotelId}`).emit('guest_online', {
    ...guestInfo,
    hotelId,
    timestamp: new Date().toISOString()
  });

  console.log(`🟢 [${hotelId}] Guest online: ${guestInfo.guestName} (Room ${guestInfo.roomNumber})`);
};

/**
 * Broadcast guest offline status
 */
const broadcastGuestOffline = (hotelId, guestInfo) => {
  const io = getIO();
  if (!io || !hotelId) return;

  io.to(`admin_${hotelId}`).emit('guest_offline', {
    ...guestInfo,
    hotelId,
    timestamp: new Date().toISOString()
  });

  console.log(`🔴 [${hotelId}] Guest offline: ${guestInfo.guestName} (Room ${guestInfo.roomNumber})`);
};

// ============================================================
// SYNC FUNCTIONS
// ============================================================

/**
 * Trigger full data sync for a hotel
 * Used by: Initial load, reconnection
 */
const broadcastSyncAll = (hotelId, data) => {
  const io = getIO();
  if (!io || !hotelId) return;

  io.to(`hotel_${hotelId}`).emit('sync_all', {
    ...data,
    hotelId,
    syncToken: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString()
  });

  console.log(`🔄 [${hotelId}] Full sync triggered`);
};

/**
 * Broadcast hotel deletion
 */
const broadcastHotelDeleted = (hotelId) => {
  const io = getIO();
  if (!io || !hotelId) return;

  io.to(`hotel_${hotelId}`).emit('hotel_deleted', {
    hotelId,
    message: 'This hotel has been deactivated',
    timestamp: new Date().toISOString()
  });

  console.log(`🗑️ [${hotelId}] Hotel deleted - notifying all clients`);
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get online count for a hotel
 */
const getOnlineCount = (hotelId) => {
  const io = getIO();
  if (!io || !hotelId) return 0;

  const room = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
  return room ? room.size : 0;
};

/**
 * Broadcast online count to specific socket
 */
const broadcastOnlineCount = (socket, hotelId) => {
  if (!socket || !hotelId) return;

  const count = getOnlineCount(hotelId);
  socket.emit('online_count', {
    count,
    hotelId,
    timestamp: new Date().toISOString()
  });
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Core broadcast functions
  broadcast,
  broadcastToAdmins,
  broadcastToGuests,
  broadcastToRoom,

  // Event-specific helpers
  broadcastNewRequest,
  broadcastRequestUpdate,
  broadcastRoomUpdate,
  broadcastGuestUpdate,
  broadcastFoodUpdate,
  broadcastInventoryUpdate,
  broadcastBookingUpdate,
  broadcastStaffUpdate,
  broadcastNewReview,
  broadcastConfigUpdate,
  broadcastPolicyUpdate,
  broadcastAnnouncementUpdate,
  broadcastDepartmentUpdate,
  broadcastBlacklistUpdate,
  broadcastMaintenanceUpdate,
  broadcastLogsUpdate,
  broadcastCurrencyUpdate,

  // Guest ↔ Admin communication
  broadcastGuestAction,
  broadcastAdminAction,
  broadcastAdminReply,

  // Online/Offline status
  broadcastGuestOnline,
  broadcastGuestOffline,

  // Sync functions
  broadcastSyncAll,
  broadcastHotelDeleted,

  // Utility functions
  getOnlineCount,
  broadcastOnlineCount
};