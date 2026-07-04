// ============================================
// LOST & FOUND MODEL (Native Driver Schema)
// ============================================
const LostFound = {
  collection: 'lostFound',

  schema: {
    itemName: { type: 'string', required: true },
    description: { type: 'string', default: '' },
    color: { type: 'string', default: '' },
    brand: { type: 'string', default: '' },
    lostLocation: { type: 'string', default: '' },
    lostDate: { type: 'date', default: () => new Date() },
    guestName: { type: 'string', required: true },
    roomNumber: { type: 'string', required: true },
    contact: { type: 'string', default: '' },
    status: {
      type: 'string',
      enum: ['pending', 'found', 'claimed', 'unclaimed'],
      default: 'pending'
    },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.itemName) errors.push('Item name is required');
    if (!data.guestName) errors.push('Guest name is required');
    if (!data.roomNumber) errors.push('Room number is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { status: 1 } },
    { key: { roomNumber: 1 } },
    { key: { createdAt: -1 } },
    { key: { guestName: 1 } }
  ]
};

module.exports = LostFound;
