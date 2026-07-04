// ============================================
// ALARM MODEL (Native Driver Schema)
// ============================================
const Alarm = {
  collection: 'alarms',

  schema: {
    roomId: { type: 'string', required: true },
    time: { type: 'string', required: true }, // Format: HH:MM (24-hour)
    label: { type: 'string', default: 'Wake up' },
    repeat: { 
      type: 'string', 
      enum: ['once', 'daily', 'weekdays', 'weekends'],
      default: 'once'
    },
    isActive: { type: 'boolean', default: true },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.roomId) errors.push('Room ID is required');
    if (!data.time) errors.push('Time is required');
    if (!data.time.match(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)) {
      errors.push('Time must be in HH:MM format (24-hour)');
    }
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { roomId: 1 } },
    { key: { isActive: 1 } },
    { key: { time: 1 } }
  ]
};

module.exports = Alarm;
