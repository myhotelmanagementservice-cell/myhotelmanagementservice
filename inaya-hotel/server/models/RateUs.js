// ============================================
// RATE US MODEL (Native Driver Schema)
// ============================================
const RateUs = {
  collection: 'ratings',

  schema: {
    guestId: { type: 'string', required: true },
    roomNumber: { type: 'string', default: 'N/A' },
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', default: '' },
    category: { 
      type: 'string', 
      enum: ['general', 'service', 'cleanliness', 'food', 'staff', 'facilities', 'value'],
      default: 'general'
    },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.guestId) errors.push('Guest ID is required');
    if (!data.rating || data.rating < 1 || data.rating > 5) {
      errors.push('Rating must be between 1 and 5');
    }
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { guestId: 1 }, unique: true },
    { key: { rating: -1 } },
    { key: { category: 1 } },
    { key: { createdAt: -1 } }
  ]
};

module.exports = RateUs;
