// ============================================
// OFFER MODEL (Native Driver Schema)
// ============================================
const Offer = {
  // Collection name
  collection: 'offers',

  // Schema validation rules
  schema: {
    title: { type: 'string', required: true },
    description: { type: 'string', required: true },
    discount: { type: 'number', required: true },
    code: { type: 'string' },
    validUntil: { type: 'date' },
    active: { type: 'boolean', default: true },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  // Validation function
  validate(data) {
    const errors = [];
    if (!data.title) errors.push('Title is required');
    if (!data.description) errors.push('Description is required');
    if (!data.discount || data.discount < 0) errors.push('Valid discount is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  // Indexes for better performance
  indexes: [
    { key: { hotelId: 1 } },
    { key: { active: 1 } },
    { key: { code: 1 } },
    { key: { validUntil: 1 } }
  ]
};

module.exports = Offer;
