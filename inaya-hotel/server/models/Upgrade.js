// ============================================
// UPGRADE MODEL (Native Driver Schema)
// ============================================
const Upgrade = {
  collection: 'upgrades',

  schema: {
    guestId: { type: 'string', required: true },
    currentRoom: { type: 'string', required: true },
    requestedRoom: { type: 'string', required: true },
    reason: { type: 'string', default: '' },
    preferredDate: { type: 'date', default: () => new Date() },
    status: {
      type: 'string',
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending'
    },
    requestDate: { type: 'date', default: () => new Date() },
    approvedDate: { type: 'date' },
    rejectedDate: { type: 'date' },
    cancelledDate: { type: 'date' },
    approvedBy: { type: 'string' },
    rejectionReason: { type: 'string' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.guestId) errors.push('Guest ID is required');
    if (!data.currentRoom) errors.push('Current room is required');
    if (!data.requestedRoom) errors.push('Requested room is required');
    if (data.currentRoom === data.requestedRoom) {
      errors.push('Current room and requested room must be different');
    }
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { guestId: 1 } },
    { key: { status: 1 } },
    { key: { requestDate: -1 } },
    { key: { currentRoom: 1 } },
    { key: { requestedRoom: 1 } }
  ]
};

module.exports = Upgrade;
