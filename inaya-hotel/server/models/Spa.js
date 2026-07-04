// ============================================
// SPA MODEL (Native Driver Schema)
// ============================================
const Spa = {
  collection: 'spa',

  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string', default: '' },
    price: { type: 'number', required: true, min: 0 },
    duration: { type: 'number', required: true, min: 15 }, // in minutes
    image: { type: 'string', default: '' },
    isAvailable: { type: 'boolean', default: true },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.name) errors.push('Service name is required');
    if (!data.price || data.price < 0) errors.push('Valid price is required');
    if (!data.duration || data.duration < 15) errors.push('Duration must be at least 15 minutes');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { name: 1 } },
    { key: { isAvailable: 1 } },
    { key: { price: 1 } }
  ]
};

module.exports = Spa;
