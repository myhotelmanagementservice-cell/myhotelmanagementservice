// ============================================
// ROOM CONTROL MODEL (Native Driver Schema)
// ============================================
const RoomControl = {
  collection: 'roomControls',

  schema: {
    roomId: { type: 'string', required: true },
    temperature: { type: 'number', default: 22 },
    lights: { type: 'string', enum: ['on', 'off', 'dim'], default: 'on' },
    ac: { type: 'string', enum: ['auto', 'cool', 'heat', 'fan', 'off'], default: 'auto' },
    status: { type: 'string', enum: ['available', 'occupied', 'maintenance'], default: 'available' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.roomId) errors.push('Room ID is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    if (data.temperature && (data.temperature < 16 || data.temperature > 30)) {
      errors.push('Temperature must be between 16-30°C');
    }
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { roomId: 1 } },
    { key: { status: 1 } }
  ]
};

module.exports = RoomControl;
