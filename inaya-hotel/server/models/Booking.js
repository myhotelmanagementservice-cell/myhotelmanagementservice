// 📋 Booking Collection Schema Reference (Native MongoDB)
// Use this structure when inserting documents into the 'bookings' collection

const bookingDocument = {
  // 🔒 Multi-tenant isolation (REQUIRED)
  hotelId: String,           // e.g., "royal-saudi"

  // 🎫 Booking Information
  bookingNumber: String,     // Auto-generated: 'BKG20240601ABC123'

  // 👤 Guest Information
  guestId: ObjectId,         // Reference to guests collection (optional)
  guestName: String,         // Required
  guestEmail: String,        // Required, lowercase
  guestPhone: String,        // Required
  guestAddress: String,
  guestNationality: String,
  guestIdProof: String,

  // 🏨 Room Information
  roomId: ObjectId,          // Reference to rooms collection
  roomNumber: Number,        // e.g., 101
  roomType: String,          // 'Standard' | 'Deluxe' | 'Suite' | 'Presidential' | 'Family'
  roomPrice: Number,         // Base price per night in SAR

  // 📅 Booking Dates
  checkInDate: Date,         // Required
  checkOutDate: Date,        // Required
  actualCheckIn: Date,       // null until guest arrives
  actualCheckOut: Date,      // null until guest leaves

  // 👥 Guest Count
  adults: Number,            // min: 1, default: 1
  children: Number,          // default: 0
  infants: Number,           // default: 0

  // 💰 Pricing (calculated)
  nights: Number,            // Calculated from dates
  pricePerNight: Number,
  subtotal: Number,          // nights × pricePerNight
  tax: Number,               // default: 0
  taxRate: Number,           // default: 0
  serviceCharge: Number,     // default: 0
  discount: Number,          // default: 0
  totalPrice: Number,        // subtotal + tax + serviceCharge - discount

  // 💳 Payment Information
  paymentStatus: String,     // 'pending' | 'partial' | 'paid' | 'refunded' | 'cancelled'
  paymentMethod: String,     // 'cash' | 'card' | 'upi' | 'bank_transfer' | 'online' | 'wallet'
  paymentDetails: {
    transactionId: String,
    paidAmount: Number,
    remainingAmount: Number,
    paymentDate: Date
  },

  // 📊 Booking Status
  status: String,            // 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'

  // ✨ Special Requests
  specialRequests: String,
  preferences: Object,       // e.g., { floor: 'high', bed: 'king', view: 'sea' }

  // 🎁 Additional Services
  additionalServices: [{
    serviceName: String,
    serviceDate: Date,
    price: Number,
    status: String           // 'pending' | 'completed' | 'cancelled'
  }],

  // ❌ Cancellation
  cancelledAt: Date,
  cancellationReason: String,
  cancellationFee: Number,

  // 📡 Booking Source
  source: String,            // 'direct' | 'website' | 'phone' | 'walk_in' | 'agent' | 'online'

  // 👨‍💼 Staff Information
  bookedBy: ObjectId,        // Reference to users collection
  bookedByName: String,

  // 🕐 Timestamps
  createdAt: Date,
  updatedAt: Date,

  // 🗑️ Soft Delete
  isActive: Boolean,         // default: true
  isDeleted: Boolean,        // default: false
  deletedAt: Date
};
