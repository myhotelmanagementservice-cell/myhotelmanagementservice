// ============================================
// CITY GUIDE MODEL (Native Driver Schema)
// ============================================
const CityGuide = {
  collection: 'cityGuide',

  schema: {
    name: { type: 'string', required: true },
    category: { 
      type: 'string', 
      required: true,
      enum: ['attraction', 'restaurant', 'shopping', 'entertainment', 'transport', 'emergency', 'hospitality']
    },
    description: { type: 'string', required: true },
    address: { type: 'string', default: '' },
    phone: { type: 'string', default: '' },
    website: { type: 'string', default: '' },
    image: { type: 'string', default: '' },
    rating: { type: 'number', default: 0, min: 0, max: 5 },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.name) errors.push('Name is required');
    if (!data.category) errors.push('Category is required');
    if (!data.description) errors.push('Description is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    if (data.rating && (data.rating < 0 || data.rating > 5)) {
      errors.push('Rating must be between 0 and 5');
    }
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { category: 1 } },
    { key: { name: 1 } },
    { key: { rating: -1 } }
  ]
};

module.exports = CityGuide;
