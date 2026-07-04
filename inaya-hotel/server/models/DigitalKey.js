// ============================================
// DIGITAL KEY MODEL (Native Driver Schema)
// ============================================
const DigitalKey = {
  collection: 'digitalKeys',

  schema: {
    roomId: { type: 'string', required: true },
    guestId: { type: 'string', required: true },
    keyCode: { type: 'string', required: true, unique: true },
    validUntil: { type: 'date', required: true },
    isActive: { type: 'boolean', default: true },
    lastUsed: { type: 'date' },
    revokedAt: { type: 'date' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.roomId) errors.push('Room ID is required');
    if (!data.guestId) errors.push('Guest ID is required');
    if (!data.keyCode) errors.push('Key code is required');
    if (!data.validUntil) errors.push('Valid until date is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { roomId: 1 } },
    { key: { guestId: 1 } },
    { key: { keyCode: 1 }, unique: true },
    { key: { isActive: 1 } },
    { key: { validUntil: 1 } }
  ]
};

module.exports = DigitalKey;
