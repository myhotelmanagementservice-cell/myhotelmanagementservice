// ============================================
// LAUNDRY MODEL (Native Driver Schema)
// ============================================
const Laundry = {
  collection: 'laundry',

  schema: {
    guestId: { type: 'string', required: true },
    items: {
      type: 'array',
      required: true,
      items: {
        name: { type: 'string', required: true },
        quantity: { type: 'number', required: true, min: 1 },
        price: { type: 'number', required: true, min: 0 }
      }
    },
    total: { type: 'number', default: 0 },
    specialInstructions: { type: 'string', default: '' },
    status: {
      type: 'string',
      enum: ['pending', 'processing', 'ready', 'delivered', 'cancelled'],
      default: 'pending'
    },
    orderNumber: { type: 'string', unique: true },
    readyAt: { type: 'date' },
    deliveredAt: { type: 'date' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.guestId) errors.push('Guest ID is required');
    if (!data.items || data.items.length === 0) {
      errors.push('At least one item is required');
    }
    if (data.items && data.items.length > 0) {
      data.items.forEach((item, index) => {
        if (!item.name) errors.push(`Item ${index + 1}: Name is required`);
        if (!item.quantity || item.quantity < 1) {
          errors.push(`Item ${index + 1}: Valid quantity is required`);
        }
        if (!item.price || item.price < 0) {
          errors.push(`Item ${index + 1}: Valid price is required`);
        }
      });
    }
    if (!data.hotelId) errors.push('Hotel ID is required');
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { guestId: 1 } },
    { key: { status: 1 } },
    { key: { orderNumber: 1 }, unique: true },
    { key: { createdAt: -1 } }
  ]
};

module.exports = Laundry;
