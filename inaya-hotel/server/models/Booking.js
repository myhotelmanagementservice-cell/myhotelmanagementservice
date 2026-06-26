// server/models/Booking.js
// Booking Management Model - Native MongoDB Compatible
// Features: Complete CRUD, Price Calculation, Status Management, Payment Tracking
// Compatible with index.html (19 admin pages + 9 guest pages)

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

const BOOKING_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CHECKED_IN: 'checked_in',
    CHECKED_OUT: 'checked_out',
    CANCELLED: 'cancelled',
    NO_SHOW: 'no_show'
};

const PAYMENT_STATUS = {
    PENDING: 'pending',
    PARTIAL: 'partial',
    PAID: 'paid',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled'
};

const PAYMENT_METHODS = [
    'cash', 'card', 'upi', 'bank_transfer', 'online', 'wallet'
];

const ROOM_TYPES = [
    'Standard', 'Deluxe', 'Suite', 'Presidential', 'Family'
];

const BOOKING_SOURCES = [
    'direct', 'website', 'phone', 'walk_in', 'agent', 'online'
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate unique booking number
 * Format: BKG{YYYYMMDD}{RANDOM}
 * Example: BKG20240601ABC123
 */
async function generateBookingNumber(hotelId) {
    try {
        const db = getDB();
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
        const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();

        let bookingNumber = `BKG${dateStr}${randomStr}`;

        // Ensure uniqueness
        let exists = true;
        while (exists) {
            const existing = await db.collection('bookings').findOne({ 
                hotelId, 
                bookingNumber 
            });
            if (!existing) {
                exists = false;
            } else {
                // Generate new random string
                bookingNumber = `BKG${dateStr}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            }
        }

        return bookingNumber;
    } catch (error) {
        console.error('❌ generateBookingNumber error:', error.message);
        // Fallback to timestamp-based number
        return `BKG${Date.now()}`;
    }
}

/**
 * Calculate number of nights between check-in and check-out
 */
function calculateNights(checkInDate, checkOutDate) {
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const diffTime = checkOut - checkIn;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays);
}

/**
 * Calculate booking pricing
 */
function calculatePricing(data) {
    const nights = calculateNights(data.checkInDate, data.checkOutDate);
    const pricePerNight = data.roomPrice || data.pricePerNight || 0;
    const subtotal = nights * pricePerNight;

    const taxRate = data.taxRate || 0;
    const tax = subtotal * (taxRate / 100);

    const serviceCharge = data.serviceCharge || 0;
    const discount = data.discount || 0;

    const totalPrice = subtotal + tax + serviceCharge - discount;

    return {
        nights,
        pricePerNight,
        subtotal,
        tax,
        taxRate,
        serviceCharge,
        discount,
        totalPrice: Math.max(0, totalPrice)
    };
}

/**
 * Validate booking data
 */
function validateBooking(data) {
    const errors = [];

    if (!data.guestName || data.guestName.trim() === '') {
        errors.push('Guest name is required');
    }

    if (!data.guestEmail || data.guestEmail.trim() === '') {
        errors.push('Guest email is required');
    }

    if (!data.guestPhone || data.guestPhone.trim() === '') {
        errors.push('Guest phone is required');
    }

    if (!data.checkInDate) {
        errors.push('Check-in date is required');
    }

    if (!data.checkOutDate) {
        errors.push('Check-out date is required');
    }

    if (data.checkInDate && data.checkOutDate) {
        const checkIn = new Date(data.checkInDate);
        const checkOut = new Date(data.checkOutDate);

        if (checkOut <= checkIn) {
            errors.push('Check-out date must be after check-in date');
        }

        if (checkIn < new Date()) {
            // Allow past dates for editing existing bookings
            // errors.push('Check-in date cannot be in the past');
        }
    }

    if (data.roomNumber !== undefined && (isNaN(data.roomNumber) || data.roomNumber <= 0)) {
        errors.push('Room number must be a positive number');
    }

    if (data.adults !== undefined && (isNaN(data.adults) || data.adults < 1)) {
        errors.push('At least 1 adult is required');
    }

    if (data.roomType && !ROOM_TYPES.includes(data.roomType)) {
        errors.push(`Invalid room type. Must be one of: ${ROOM_TYPES.join(', ')}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if status transition is valid
 */
function isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
        [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
        [BOOKING_STATUS.CHECKED_IN]: [BOOKING_STATUS.CHECKED_OUT],
        [BOOKING_STATUS.CHECKED_OUT]: [],
        [BOOKING_STATUS.CANCELLED]: [],
        [BOOKING_STATUS.NO_SHOW]: []
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all bookings for a hotel
 */
async function getBookings(hotelId, filters = {}) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const query = { hotelId, isDeleted: { $ne: true } };

        // Apply filters
        if (filters.status) query.status = filters.status;
        if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
        if (filters.roomNumber) query.roomNumber = parseInt(filters.roomNumber);
        if (filters.guestName) {
            query.guestName = { $regex: new RegExp(filters.guestName, 'i') };
        }
        if (filters.checkInDate) {
            query.checkInDate = { $gte: new Date(filters.checkInDate) };
        }
        if (filters.checkOutDate) {
            query.checkOutDate = { $lte: new Date(filters.checkOutDate) };
        }

        const bookings = await db.collection('bookings')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ getBookings error:', error.message);
        return [];
    }
}

/**
 * Get single booking by ID
 */
async function getBooking(hotelId, bookingId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const filter = { hotelId, isDeleted: { $ne: true } };

        if (ObjectId.isValid(bookingId)) {
            filter._id = new ObjectId(bookingId);
        } else {
            filter._id = bookingId;
        }

        const booking = await db.collection('bookings').findOne(filter);

        if (booking) {
            if (booking._id) booking._id = booking._id.toString();
            if (booking.guestId) booking.guestId = booking.guestId.toString();
            if (booking.roomId) booking.roomId = booking.roomId.toString();
            if (booking.bookedBy) booking.bookedBy = booking.bookedBy.toString();
        }

        return booking;
    } catch (error) {
        console.error('❌ getBooking error:', error.message);
        return null;
    }
}

/**
 * Get booking by booking number
 */
async function getBookingByNumber(hotelId, bookingNumber) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const booking = await db.collection('bookings').findOne({
            hotelId,
            bookingNumber,
            isDeleted: { $ne: true }
        });

        if (booking) {
            if (booking._id) booking._id = booking._id.toString();
            if (booking.guestId) booking.guestId = booking.guestId.toString();
            if (booking.roomId) booking.roomId = booking.roomId.toString();
            if (booking.bookedBy) booking.bookedBy = booking.bookedBy.toString();
        }

        return booking;
    } catch (error) {
        console.error('❌ getBookingByNumber error:', error.message);
        return null;
    }
}

/**
 * Create new booking
 */
async function createBooking(hotelId, data, user = null) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateBooking(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Generate booking number
        const bookingNumber = await generateBookingNumber(hotelId);

        // Calculate pricing
        const pricing = calculatePricing(data);

        // Prepare booking document
        const booking = {
            hotelId,
            bookingNumber,

            // Guest information
            guestId: data.guestId || null,
            guestName: data.guestName.trim(),
            guestEmail: data.guestEmail.toLowerCase().trim(),
            guestPhone: data.guestPhone.trim(),
            guestAddress: data.guestAddress || '',
            guestNationality: data.guestNationality || '',
            guestIdProof: data.guestIdProof || '',

            // Room information
            roomId: data.roomId || null,
            roomNumber: data.roomNumber ? parseInt(data.roomNumber) : null,
            roomType: data.roomType || 'Standard',
            roomPrice: data.roomPrice || data.pricePerNight || 0,

            // Dates
            checkInDate: new Date(data.checkInDate),
            checkOutDate: new Date(data.checkOutDate),
            actualCheckIn: null,
            actualCheckOut: null,

            // Guest count
            adults: data.adults || 1,
            children: data.children || 0,
            infants: data.infants || 0,

            // Pricing
            ...pricing,

            // Payment
            paymentStatus: data.paymentStatus || PAYMENT_STATUS.PENDING,
            paymentMethod: data.paymentMethod || null,
            paymentDetails: data.paymentDetails || {
                transactionId: null,
                paidAmount: 0,
                remainingAmount: pricing.totalPrice,
                paymentDate: null
            },

            // Status
            status: data.status || BOOKING_STATUS.PENDING,

            // Special requests
            specialRequests: data.specialRequests || '',
            preferences: data.preferences || {},

            // Additional services
            additionalServices: data.additionalServices || [],

            // Cancellation
            cancelledAt: null,
            cancellationReason: null,
            cancellationFee: 0,

            // Source
            source: data.source || 'direct',

            // Staff
            bookedBy: user?._id || null,
            bookedByName: user?.name || user?.email || 'system',

            // Timestamps
            createdAt: new Date(),
            updatedAt: new Date(),

            // Soft delete
            isActive: true,
            isDeleted: false,
            deletedAt: null
        };

        const result = await db.collection('bookings').insertOne(booking);
        booking._id = result.insertedId.toString();

        console.log(`✅ Booking created: ${bookingNumber} (Hotel: ${hotelId})`);
        return booking;
    } catch (error) {
        console.error('❌ createBooking error:', error.message);
        throw error;
    }
}

/**
 * Update booking
 */
async function updateBooking(hotelId, bookingId, updates, user = null) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const filter = { hotelId, isDeleted: { $ne: true } };

        if (ObjectId.isValid(bookingId)) {
            filter._id = new ObjectId(bookingId);
        } else {
            filter._id = bookingId;
        }

        // Get current booking
        const currentBooking = await db.collection('bookings').findOne(filter);
        if (!currentBooking) {
            throw new Error('Booking not found');
        }

        // Build update object
        const updateData = { updatedAt: new Date() };

        // Update guest information
        if (updates.guestName) updateData.guestName = updates.guestName.trim();
        if (updates.guestEmail) updateData.guestEmail = updates.guestEmail.toLowerCase().trim();
        if (updates.guestPhone) updateData.guestPhone = updates.guestPhone.trim();
        if (updates.guestAddress !== undefined) updateData.guestAddress = updates.guestAddress;
        if (updates.guestNationality !== undefined) updateData.guestNationality = updates.guestNationality;
        if (updates.guestIdProof !== undefined) updateData.guestIdProof = updates.guestIdProof;

        // Update room information
        if (updates.roomNumber !== undefined) {
            updateData.roomNumber = updates.roomNumber ? parseInt(updates.roomNumber) : null;
        }
        if (updates.roomType) updateData.roomType = updates.roomType;
        if (updates.roomPrice !== undefined) updateData.roomPrice = updates.roomPrice;

        // Update dates
        if (updates.checkInDate) updateData.checkInDate = new Date(updates.checkInDate);
        if (updates.checkOutDate) updateData.checkOutDate = new Date(updates.checkOutDate);

        // Update guest count
        if (updates.adults !== undefined) updateData.adults = updates.adults;
        if (updates.children !== undefined) updateData.children = updates.children;
        if (updates.infants !== undefined) updateData.infants = updates.infants;

        // Recalculate pricing if dates or price changed
        if (updates.checkInDate || updates.checkOutDate || updates.roomPrice !== undefined) {
            const pricingData = {
                checkInDate: updates.checkInDate || currentBooking.checkInDate,
                checkOutDate: updates.checkOutDate || currentBooking.checkOutDate,
                roomPrice: updates.roomPrice !== undefined ? updates.roomPrice : currentBooking.roomPrice,
                taxRate: currentBooking.taxRate,
                serviceCharge: currentBooking.serviceCharge,
                discount: currentBooking.discount
            };
            const pricing = calculatePricing(pricingData);
            Object.assign(updateData, pricing);
        }

        // Update payment
        if (updates.paymentStatus) updateData.paymentStatus = updates.paymentStatus;
        if (updates.paymentMethod) updateData.paymentMethod = updates.paymentMethod;
        if (updates.paymentDetails) {
            updateData.paymentDetails = {
                ...currentBooking.paymentDetails,
                ...updates.paymentDetails
            };
        }

        // Update status with validation
        if (updates.status) {
            if (!isValidStatusTransition(currentBooking.status, updates.status)) {
                throw new Error(`Invalid status transition from ${currentBooking.status} to ${updates.status}`);
            }
            updateData.status = updates.status;

            // Handle special status transitions
            if (updates.status === BOOKING_STATUS.CHECKED_IN) {
                updateData.actualCheckIn = new Date();
            } else if (updates.status === BOOKING_STATUS.CHECKED_OUT) {
                updateData.actualCheckOut = new Date();
            } else if (updates.status === BOOKING_STATUS.CANCELLED) {
                updateData.cancelledAt = new Date();
                updateData.cancellationReason = updates.cancellationReason || null;
                updateData.cancellationFee = updates.cancellationFee || 0;
            }
        }

        // Update special requests
        if (updates.specialRequests !== undefined) updateData.specialRequests = updates.specialRequests;
        if (updates.preferences !== undefined) updateData.preferences = updates.preferences;

        // Update additional services
        if (updates.additionalServices !== undefined) {
            updateData.additionalServices = updates.additionalServices;
        }

        // Update source
        if (updates.source) updateData.source = updates.source;

        const result = await db.collection('bookings').findOneAndUpdate(
            filter,
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Failed to update booking');
        }

        if (result._id) result._id = result._id.toString();
        if (result.guestId) result.guestId = result.guestId.toString();
        if (result.roomId) result.roomId = result.roomId.toString();
        if (result.bookedBy) result.bookedBy = result.bookedBy.toString();

        console.log(`✅ Booking updated: ${result.bookingNumber} (ID: ${bookingId})`);
        return result;
    } catch (error) {
        console.error('❌ updateBooking error:', error.message);
        throw error;
    }
}

/**
 * Delete booking (soft delete)
 */
async function deleteBooking(hotelId, bookingId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const filter = { hotelId, isDeleted: { $ne: true } };

        if (ObjectId.isValid(bookingId)) {
            filter._id = new ObjectId(bookingId);
        } else {
            filter._id = bookingId;
        }

        const result = await db.collection('bookings').findOneAndUpdate(
            filter,
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    isActive: false,
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Booking not found');
        }

        console.log(`✅ Booking deleted (soft): ${result.bookingNumber}`);
        return true;
    } catch (error) {
        console.error('❌ deleteBooking error:', error.message);
        throw error;
    }
}

/**
 * Permanently delete booking (hard delete)
 */
async function permanentlyDeleteBooking(hotelId, bookingId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const filter = { hotelId };

        if (ObjectId.isValid(bookingId)) {
            filter._id = new ObjectId(bookingId);
        } else {
            filter._id = bookingId;
        }

        const result = await db.collection('bookings').deleteOne(filter);

        if (result.deletedCount === 0) {
            throw new Error('Booking not found');
        }

        console.log(`✅ Booking permanently deleted (ID: ${bookingId})`);
        return true;
    } catch (error) {
        console.error('❌ permanentlyDeleteBooking error:', error.message);
        throw error;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================

/**
 * Confirm booking
 */
async function confirmBooking(hotelId, bookingId) {
    return await updateBooking(hotelId, bookingId, {
        status: BOOKING_STATUS.CONFIRMED
    });
}

/**
 * Check in guest
 */
async function checkInGuest(hotelId, bookingId) {
    return await updateBooking(hotelId, bookingId, {
        status: BOOKING_STATUS.CHECKED_IN
    });
}

/**
 * Check out guest
 */
async function checkOutGuest(hotelId, bookingId) {
    return await updateBooking(hotelId, bookingId, {
        status: BOOKING_STATUS.CHECKED_OUT
    });
}

/**
 * Cancel booking
 */
async function cancelBooking(hotelId, bookingId, reason = '', fee = 0) {
    return await updateBooking(hotelId, bookingId, {
        status: BOOKING_STATUS.CANCELLED,
        cancellationReason: reason,
        cancellationFee: fee
    });
}

/**
 * Mark as no-show
 */
async function markNoShow(hotelId, bookingId) {
    return await updateBooking(hotelId, bookingId, {
        status: BOOKING_STATUS.NO_SHOW
    });
}

// ============================================================
// PAYMENT MANAGEMENT
// ============================================================

/**
 * Record payment
 */
async function recordPayment(hotelId, bookingId, paymentData) {
    try {
        const booking = await getBooking(hotelId, bookingId);
        if (!booking) {
            throw new Error('Booking not found');
        }

        const paidAmount = paymentData.paidAmount || 0;
        const currentPaid = booking.paymentDetails?.paidAmount || 0;
        const newPaidAmount = currentPaid + paidAmount;
        const remainingAmount = booking.totalPrice - newPaidAmount;

        let paymentStatus = PAYMENT_STATUS.PENDING;
        if (newPaidAmount >= booking.totalPrice) {
            paymentStatus = PAYMENT_STATUS.PAID;
        } else if (newPaidAmount > 0) {
            paymentStatus = PAYMENT_STATUS.PARTIAL;
        }

        return await updateBooking(hotelId, bookingId, {
            paymentStatus,
            paymentMethod: paymentData.paymentMethod,
            paymentDetails: {
                transactionId: paymentData.transactionId || null,
                paidAmount: newPaidAmount,
                remainingAmount: Math.max(0, remainingAmount),
                paymentDate: new Date()
            }
        });
    } catch (error) {
        console.error('❌ recordPayment error:', error.message);
        throw error;
    }
}

/**
 * Refund payment
 */
async function refundPayment(hotelId, bookingId, refundAmount) {
    try {
        const booking = await getBooking(hotelId, bookingId);
        if (!booking) {
            throw new Error('Booking not found');
        }

        return await updateBooking(hotelId, bookingId, {
            paymentStatus: PAYMENT_STATUS.REFUNDED,
            paymentDetails: {
                ...booking.paymentDetails,
                paidAmount: 0,
                remainingAmount: booking.totalPrice,
                refundAmount: refundAmount,
                refundDate: new Date()
            }
        });
    } catch (error) {
        console.error('❌ refundPayment error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================

/**
 * Search bookings
 */
async function searchBookings(hotelId, query) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const searchRegex = new RegExp(query, 'i');

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                $or: [
                    { bookingNumber: searchRegex },
                    { guestName: searchRegex },
                    { guestEmail: searchRegex },
                    { guestPhone: searchRegex }
                ]
            })
            .sort({ createdAt: -1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ searchBookings error:', error.message);
        return [];
    }
}

/**
 * Get bookings by date range
 */
async function getBookingsByDateRange(hotelId, startDate, endDate) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                checkInDate: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            })
            .sort({ checkInDate: 1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ getBookingsByDateRange error:', error.message);
        return [];
    }
}

/**
 * Get bookings by room number
 */
async function getBookingsByRoom(hotelId, roomNumber) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                roomNumber: parseInt(roomNumber),
                isDeleted: { $ne: true }
            })
            .sort({ checkInDate: -1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ getBookingsByRoom error:', error.message);
        return [];
    }
}

/**
 * Get today's check-ins
 */
async function getTodayCheckIns(hotelId) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                checkInDate: {
                    $gte: today,
                    $lt: tomorrow
                },
                status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING] }
            })
            .sort({ checkInDate: 1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ getTodayCheckIns error:', error.message);
        return [];
    }
}

/**
 * Get today's check-outs
 */
async function getTodayCheckOuts(hotelId) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                checkOutDate: {
                    $gte: today,
                    $lt: tomorrow
                },
                status: BOOKING_STATUS.CHECKED_IN
            })
            .sort({ checkOutDate: 1 })
            .toArray();

        bookings.forEach(b => {
            if (b._id) b._id = b._id.toString();
            if (b.guestId) b.guestId = b.guestId.toString();
            if (b.roomId) b.roomId = b.roomId.toString();
            if (b.bookedBy) b.bookedBy = b.bookedBy.toString();
        });

        return bookings;
    } catch (error) {
        console.error('❌ getTodayCheckOuts error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get booking statistics
 */
async function getBookingStats(hotelId, dateRange = {}) {
    try {
        if (!isConnected()) {
            return { total: 0, revenue: 0, byStatus: {}, byRoomType: {} };
        }

        const db = getDB();
        if (!db) {
            return { total: 0, revenue: 0, byStatus: {}, byRoomType: {} };
        }

        const query = { hotelId, isDeleted: { $ne: true } };

        // Apply date range if provided
        if (dateRange.startDate || dateRange.endDate) {
            query.createdAt = {};
            if (dateRange.startDate) query.createdAt.$gte = new Date(dateRange.startDate);
            if (dateRange.endDate) query.createdAt.$lte = new Date(dateRange.endDate);
        }

        const bookings = await db.collection('bookings')
            .find(query)
            .toArray();

        // Calculate statistics
        const totalBookings = bookings.length;
        const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
        const paidRevenue = bookings
            .filter(b => b.paymentStatus === PAYMENT_STATUS.PAID)
            .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

        // Count by status
        const byStatus = {};
        bookings.forEach(b => {
            const status = b.status || 'unknown';
            byStatus[status] = (byStatus[status] || 0) + 1;
        });

        // Count by room type
        const byRoomType = {};
        bookings.forEach(b => {
            const roomType = b.roomType || 'Unknown';
            byRoomType[roomType] = (byRoomType[roomType] || 0) + 1;
        });

        // Count by payment status
        const byPaymentStatus = {};
        bookings.forEach(b => {
            const status = b.paymentStatus || 'unknown';
            byPaymentStatus[status] = (byPaymentStatus[status] || 0) + 1;
        });

        // Average booking value
        const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

        return {
            total: totalBookings,
            revenue: totalRevenue,
            paidRevenue,
            avgBookingValue: Math.round(avgBookingValue * 100) / 100,
            byStatus,
            byRoomType,
            byPaymentStatus
        };
    } catch (error) {
        console.error('❌ getBookingStats error:', error.message);
        return { total: 0, revenue: 0, byStatus: {}, byRoomType: {} };
    }
}

/**
 * Get booking count
 */
async function getBookingCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };

        if (filters.status) query.status = filters.status;
        if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

        return await db.collection('bookings').countDocuments(query);
    } catch (error) {
        console.error('❌ getBookingCount error:', error.message);
        return 0;
    }
}

/**
 * Get revenue summary
 */
async function getRevenueSummary(hotelId, period = 'month') {
    try {
        if (!isConnected()) return { total: 0, paid: 0, pending: 0 };

        const db = getDB();
        if (!db) return { total: 0, paid: 0, pending: 0 };

        const now = new Date();
        let startDate;

        if (period === 'day') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
        } else if (period === 'month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (period === 'year') {
            startDate = new Date(now.getFullYear(), 0, 1);
        } else {
            startDate = new Date(0); // All time
        }

        const bookings = await db.collection('bookings')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                createdAt: { $gte: startDate },
                status: { $ne: BOOKING_STATUS.CANCELLED }
            })
            .toArray();

        const total = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
        const paid = bookings
            .filter(b => b.paymentStatus === PAYMENT_STATUS.PAID)
            .reduce((sum, b) => sum + (b.totalPrice || 0), 0);
        const pending = total - paid;

        return {
            total: Math.round(total * 100) / 100,
            paid: Math.round(paid * 100) / 100,
            pending: Math.round(pending * 100) / 100,
            period,
            startDate,
            endDate: now
        };
    } catch (error) {
        console.error('❌ getRevenueSummary error:', error.message);
        return { total: 0, paid: 0, pending: 0 };
    }
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for bookings collection
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound index for hotel + booking number
        await db.collection('bookings').createIndex(
            { hotelId: 1, bookingNumber: 1 },
            { unique: true, background: true, name: 'hotelId_bookingNumber_unique' }
        );

        // Index for status-based queries
        await db.collection('bookings').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );

        // Index for date-based queries
        await db.collection('bookings').createIndex(
            { hotelId: 1, checkInDate: 1, checkOutDate: 1 },
            { background: true, name: 'hotelId_dates_idx' }
        );

        // Index for room-based queries
        await db.collection('bookings').createIndex(
            { hotelId: 1, roomNumber: 1 },
            { background: true, name: 'hotelId_roomNumber_idx' }
        );

        // Index for guest searches
        await db.collection('bookings').createIndex(
            { hotelId: 1, guestName: 1 },
            { background: true, name: 'hotelId_guestName_idx' }
        );

        // Index for payment status
        await db.collection('bookings').createIndex(
            { hotelId: 1, paymentStatus: 1 },
            { background: true, name: 'hotelId_paymentStatus_idx' }
        );

        // Index for soft delete
        await db.collection('bookings').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Booking indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    BOOKING_STATUS,
    PAYMENT_STATUS,
    PAYMENT_METHODS,
    ROOM_TYPES,
    BOOKING_SOURCES,

    // CRUD operations
    getBookings,
    getBooking,
    getBookingByNumber,
    createBooking,
    updateBooking,
    deleteBooking,
    permanentlyDeleteBooking,

    // Status management
    confirmBooking,
    checkInGuest,
    checkOutGuest,
    cancelBooking,
    markNoShow,

    // Payment management
    recordPayment,
    refundPayment,

    // Search & filter
    searchBookings,
    getBookingsByDateRange,
    getBookingsByRoom,
    getTodayCheckIns,
    getTodayCheckOuts,

    // Statistics
    getBookingStats,
    getBookingCount,
    getRevenueSummary,

    // Helpers
    generateBookingNumber,
    calculateNights,
    calculatePricing,
    validateBooking,
    isValidStatusTransition,

    // Index management
    createIndexes
};