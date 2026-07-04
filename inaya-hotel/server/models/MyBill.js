// ============================================
// MY BILL MODEL (Native Driver Schema)
// ============================================
const MyBill = {
  collection: 'bills',

  schema: {
    guestId: { type: 'string', required: true },
    items: { 
      type: 'array', 
      required: true,
      items: {
        item: { type: 'string', required: true },
        price: { type: 'number', required: true },
        addedAt: { type: 'date', default: () => new Date() }
      }
    },
    total: { type: 'number', required: true, default: 0 },
    status: { type: 'string', enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
    paymentMethod: { type: 'string', enum: ['cash', 'card', 'online', 'upi'], default: 'cash' },
    paidAt: { type: 'date' },
    hotelId: { type: 'string', required: true },
    createdAt: { type: 'date', default: () => new Date() },
    updatedAt: { type: 'date', default: () => new Date() }
  },

  validate(data) {
    const errors = [];
    if (!data.guestId) errors.push('Guest ID is required');
    if (!data.items || data.items.length === 0) errors.push('At least one item is required');
    if (data.total && data.total < 0) errors.push('Total cannot be negative');
    if (!data.hotelId) errors.push('Hotel ID is required');
    
    // Validate each item
    if (data.items && data.items.length > 0) {
      data.items.forEach((item, index) => {
        if (!item.item) errors.push(`Item ${index + 1}: Item name is required`);
        if (!item.price || item.price < 0) errors.push(`Item ${index + 1}: Valid price is required`);
      });
    }
    return errors;
  },

  indexes: [
    { key: { hotelId: 1 } },
    { key: { guestId: 1 } },
    { key: { status: 1 } },
    { key: { createdAt: -1 } }
  ]
};

module.exports = MyBill;
