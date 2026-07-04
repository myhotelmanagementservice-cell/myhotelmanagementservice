// ============================================
// MENU MODEL (Native Driver Schema)
// ============================================
const Menu = {
  collection: 'menu',

  schema: {
    name: { type: 'string', required: true },
    category: { 
      type: 'string', 
      required: true,
      enum: ['appetizer', 'main_course', 'dessert', 'beverage', 'snack', 'special']
    },
    price: { type: 'number', required: true, min: 0 },
    description: { type: 'string', default: '' },
    image: { type: 'string', default: '' },
    isAvailable: { type: 'boolean', default: true },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.name) errors.push('Item name is required');
    if (!data.category) errors.push('Category is required');
    if (!data.price || data.price < 0) errors.push('Valid price is required');
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { category: 1 } },
    { key: { name: 1 } },
    { key: { isAvailable: 1 } },
    { key: { price: 1 } }
  ]
};

module.exports = Menu;
