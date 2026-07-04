// ============================================
// LIVE CHAT MODEL (Native Driver Schema)
// ============================================
const LiveChat = {
  collection: 'messages',

  schema: {
    roomId: { type: 'string', required: true },
    sender: { type: 'string', enum: ['guest', 'admin', 'staff'], default: 'guest' },
    text: { type: 'string', required: true },
    read: { type: 'boolean', default: false },
    readAt: { type: 'date' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.roomId) errors.push('Room ID is required');
    if (!data.text) errors.push('Message text is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { roomId: 1 } },
    { key: { createdAt: -1 } },
    { key: { read: 1 } },
    { key: { sender: 1 } }
  ]
};

module.exports = LiveChat;
