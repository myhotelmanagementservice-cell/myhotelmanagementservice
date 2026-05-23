const mongoose = require('mongoose');

// ============================================
// BOOKING SCHEMA - Hotel Room Bookings
// ============================================

const bookingSchema = new mongoose.Schema({
    // Multi-tenant support
    hotelId: {
        type: String,
        required: [true, 'Hotel ID is required'],
        index: true
    },

    // Booking Information
    bookingNumber: {
        type: String,
        unique: true,
        required: true,
        default: function() {
            return 'BKG' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        }
    },

    // Guest Information
    guestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Guest',
        index: true
    },
    guestName: {
        type: String,
        required: [true, 'Guest name is required'],
        trim: true
    },
    guestEmail: {
        type: String,
        required: [true, 'Guest email is required'],
        lowercase: true,
        trim: true
    },
    guestPhone: {
        type: String,
        required: [true, 'Guest phone is required']
    },
    guestAddress: {
        type: String,
        default: ''
    },
    guestNationality: {
        type: String,
        default: ''
    },
    guestIdProof: {
        type: String,
        default: ''
    },

    // Room Information
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
        required: true
    },
    roomNumber: {
        type: String,
        required: true
    },
    roomType: {
        type: String,
        enum: ['Standard', 'Deluxe', 'Suite', 'Presidential', 'Family'],
        required: true
    },
    roomPrice: {
        type: Number,
        required: true
    },

    // Booking Dates
    checkInDate: {
        type: Date,
        required: [true, 'Check-in date is required']
    },
    checkOutDate: {
        type: Date,
        required: [true, 'Check-out date is required']
    },
    actualCheckIn: {
        type: Date,
        default: null
    },
    actualCheckOut: {
        type: Date,
        default: null
    },

    // Guest Count
    adults: {
        type: Number,
        required: true,
        min: 1,
        default: 1
    },
    children: {
        type: Number,
        default: 0,
        min: 0
    },
    infants: {
        type: Number,
        default: 0,
        min: 0
    },

    // Pricing
    nights: {
        type: Number,
        required: true
    },
    pricePerNight: {
        type: Number,
        required: true
    },
    subtotal: {
        type: Number,
        required: true
    },
    tax: {
        type: Number,
        default: 0
    },
    taxRate: {
        type: Number,
        default: 0
    },
    serviceCharge: {
        type: Number,
        default: 0
    },
    discount: {
        type: Number,
        default: 0
    },
    totalPrice: {
        type: Number,
        required: true
    },

    // Payment Information
    paymentStatus: {
        type: String,
        enum: ['pending', 'partial', 'paid', 'refunded', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'upi', 'bank_transfer', 'online', 'wallet'],
        default: 'cash'
    },
    paymentDetails: {
        transactionId: { type: String, default: '' },
        paidAmount: { type: Number, default: 0 },
        remainingAmount: { type: Number, default: 0 },
        paymentDate: { type: Date, default: null }
    },

    // Booking Status
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'],
        default: 'pending',
        index: true
    },

    // Special Requests
    specialRequests: {
        type: String,
        default: ''
    },
    preferences: {
        type: Map,
        of: String,
        default: () => new Map()
    },

    // Additional Services
    additionalServices: [{
        serviceName: String,
        serviceDate: Date,
        price: Number,
        status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' }
    }],

    // Cancellation
    cancelledAt: {
        type: Date,
        default: null
    },
    cancellationReason: {
        type: String,
        default: ''
    },
    cancellationFee: {
        type: Number,
        default: 0
    },

    // Booking Source
    source: {
        type: String,
        enum: ['direct', 'website', 'phone', 'walk_in', 'agent', 'online'],
        default: 'direct'
    },

    // Staff Information
    bookedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    bookedByName: {
        type: String,
        default: ''
    },

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Soft Delete
    isActive: {
        type: Boolean,
        default: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================
// INDEXES for better performance
// ============================================
bookingSchema.index({ hotelId: 1, status: 1, checkInDate: 1 });
bookingSchema.index({ hotelId: 1, bookingNumber: 1 });
bookingSchema.index({ hotelId: 1, guestId: 1 });
bookingSchema.index({ checkInDate: 1, status: 1 });
bookingSchema.index({ checkOutDate: 1, status: 1 });
bookingSchema.index({ createdAt: -1 });

// ============================================
// VIRTUAL FIELDS
// ============================================

// Calculate total nights
bookingSchema.virtual('totalNights').get(function() {
    if (!this.checkInDate || !this.checkOutDate) return 0;
    const diffTime = Math.abs(this.checkOutDate - this.checkInDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Check if booking is upcoming
bookingSchema.virtual('isUpcoming').get(function() {
    return this.status === 'confirmed' && this.checkInDate > new Date();
});

// Check if booking is current
bookingSchema.virtual('isCurrent').get(function() {
    const now = new Date();
    return this.status === 'checked_in' || 
           (this.status === 'confirmed' && this.checkInDate <= now && this.checkOutDate >= now);
});

// Check if booking is completed
bookingSchema.virtual('isCompleted').get(function() {
    return this.status === 'checked_out';
});

// ============================================
// INSTANCE METHODS
// ============================================

// Mark as checked in
bookingSchema.methods.markCheckedIn = async function() {
    this.status = 'checked_in';
    this.actualCheckIn = new Date();
    this.updatedAt = new Date();
    return await this.save();
};

// Mark as checked out
bookingSchema.methods.markCheckedOut = async function() {
    this.status = 'checked_out';
    this.actualCheckOut = new Date();
    this.updatedAt = new Date();
    return await this.save();
};

// Cancel booking
bookingSchema.methods.cancelBooking = async function(reason, fee = 0) {
    this.status = 'cancelled';
    this.cancelledAt = new Date();
    this.cancellationReason = reason;
    this.cancellationFee = fee;
    this.paymentStatus = 'cancelled';
    this.updatedAt = new Date();
    return await this.save();
};

// Add payment
bookingSchema.methods.addPayment = async function(amount, method, transactionId = '') {
    const paid = (this.paymentDetails.paidAmount || 0) + amount;
    const remaining = this.totalPrice - paid;

    this.paymentDetails.paidAmount = paid;
    this.paymentDetails.remainingAmount = remaining;
    this.paymentDetails.transactionId = transactionId;
    this.paymentDetails.paymentDate = new Date();
    this.paymentMethod = method;

    if (remaining <= 0) {
        this.paymentStatus = 'paid';
    } else if (paid > 0) {
        this.paymentStatus = 'partial';
    }

    this.updatedAt = new Date();
    return await this.save();
};

// Update booking dates
bookingSchema.methods.updateDates = async function(checkIn, checkOut) {
    this.checkInDate = checkIn;
    this.checkOutDate = checkOut;
    this.nights = this.totalNights;
    this.totalPrice = this.nights * this.pricePerNight;
    this.updatedAt = new Date();
    return await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

// Get bookings by hotel
bookingSchema.statics.findByHotel = function(hotelId, options = {}) {
    const { status, startDate, endDate, limit = 100 } = options;
    let query = { hotelId, isActive: true, isDeleted: false };

    if (status) query.status = status;
    if (startDate && endDate) {
        query.checkInDate = { $gte: startDate, $lte: endDate };
    }

    return this.find(query)
        .sort({ checkInDate: 1 })
        .limit(limit);
};

// Get today's check-ins
bookingSchema.statics.getTodayCheckIns = function(hotelId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.find({
        hotelId,
        status: 'confirmed',
        checkInDate: { $gte: today, $lt: tomorrow }
    }).populate('roomId', 'roomNumber type');
};

// Get today's check-outs
bookingSchema.statics.getTodayCheckOuts = function(hotelId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.find({
        hotelId,
        status: 'checked_in',
        checkOutDate: { $gte: today, $lt: tomorrow }
    }).populate('roomId', 'roomNumber type');
};

// Get occupancy rate for date range
bookingSchema.statics.getOccupancyRate = async function(hotelId, startDate, endDate) {
    const bookings = await this.find({
        hotelId,
        status: { $in: ['confirmed', 'checked_in'] },
        $or: [
            { checkInDate: { $lte: endDate, $gte: startDate } },
            { checkOutDate: { $lte: endDate, $gte: startDate } }
        ]
    });

    return {
        totalBookings: bookings.length,
        bookings: bookings
    };
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

// Calculate total price and nights before saving
bookingSchema.pre('save', function(next) {
    if (this.isModified('checkInDate') || this.isModified('checkOutDate') || this.isModified('pricePerNight')) {
        this.nights = this.totalNights;
        this.subtotal = this.nights * this.pricePerNight;
        this.totalPrice = this.subtotal + this.tax + this.serviceCharge - this.discount;

        // Update remaining amount
        if (this.paymentDetails.paidAmount) {
            this.paymentDetails.remainingAmount = this.totalPrice - this.paymentDetails.paidAmount;
        } else {
            this.paymentDetails.remainingAmount = this.totalPrice;
        }
    }

    this.updatedAt = new Date();
    next();
});

// Generate booking number if not present
bookingSchema.pre('save', function(next) {
    if (!this.bookingNumber) {
        const prefix = 'BKG';
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const random = Math.random().toString(36).substr(2, 6).toUpperCase();
        this.bookingNumber = `${prefix}${year}${month}${day}${random}`;
    }
    next();
});

// ============================================
// MODEL CREATION
// ============================================
const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
