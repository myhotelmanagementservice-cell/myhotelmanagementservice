// server/models/Cab.js
// Cab/Taxi Service Management Model - Native MongoDB Compatible
// Features: Complete CRUD, Price Calculation, Status Management, Analytics
// Compatible with index.html (19 admin pages + 9 guest pages)

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

const CAB_TYPES = {
    AIRPORT: 'airport',
    LOCAL: 'local'
};

const CAB_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate cab booking data
 * @param {Object} data - Cab booking data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateCabBooking(data) {
    const errors = [];

    if (!data.guestName || data.guestName.trim() === '') {
        errors.push('Guest name is required');
    }

    if (data.roomNumber === undefined || data.roomNumber === null || isNaN(data.roomNumber)) {
        errors.push('Room number is required');
    }

    if (!data.type || !Object.values(CAB_TYPES).includes(data.type)) {
        errors.push(`Invalid cab type. Must be one of: ${Object.values(CAB_TYPES).join(', ')}`);
    }

    if (data.status && !Object.values(CAB_STATUS).includes(data.status)) {
        errors.push(`Invalid status. Must be one of: ${Object.values(CAB_STATUS).join(', ')}`);
    }

    if (data.price !== undefined && (isNaN(data.price) || data.price < 0)) {
        errors.push('Price must be a non-negative number');
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
        [CAB_STATUS.PENDING]: [CAB_STATUS.CONFIRMED, CAB_STATUS.CANCELLED],
        [CAB_STATUS.CONFIRMED]: [CAB_STATUS.IN_PROGRESS, CAB_STATUS.CANCELLED],
        [CAB_STATUS.IN_PROGRESS]: [CAB_STATUS.COMPLETED, CAB_STATUS.CANCELLED],
        [CAB_STATUS.COMPLETED]: [],
        [CAB_STATUS.CANCELLED]: []
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
}

/**
 * Calculate cab price based on type and settings
 * @param {string} type - Cab type (airport/local)
 * @param {Object} settings - Hotel settings with prices
 * @returns {number} - Calculated price
 */
function calculatePrice(type, settings = {}) {
    if (type === CAB_TYPES.AIRPORT) {
        return settings.airportPrice || 115; // Default airport price
    } else if (type === CAB_TYPES.LOCAL) {
        return settings.localPrice || 60; // Default local price
    }
    return 0;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all cab bookings for a hotel
 * @param {string} hotelId - Hotel ID
 * @param {Object} filters - Optional filters
 * @returns {Array} - Array of cab bookings
 */
async function getCabs(hotelId, filters = {}) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const query = { hotelId };

        // Apply filters
        if (filters.status) query.status = filters.status;
        if (filters.type) query.type = filters.type;
        if (filters.roomNumber) query.roomNumber = parseInt(filters.roomNumber);
        if (filters.guestName) {
            query.guestName = { $regex: new RegExp(filters.guestName, 'i') };
        }

        const cabs = await db.collection('cabs')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        // Convert ObjectIds to strings
        cabs.forEach(cab => {
            if (cab._id) cab._id = cab._id.toString();
        });

        return cabs;
    } catch (error) {
        console.error('❌ getCabs error:', error.message);
        return [];
    }
}

/**
 * Get single cab booking by ID
 * @param {string} hotelId - Hotel ID
 * @param {string} cabId - Cab booking ID
 * @returns {Object|null} - Cab booking or null
 */
async function getCab(hotelId, cabId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const filter = { hotelId };

        if (ObjectId.isValid(cabId)) {
            filter._id = new ObjectId(cabId);
        } else {
            filter._id = cabId;
        }

        const cab = await db.collection('cabs').findOne(filter);

        if (cab && cab._id) {
            cab._id = cab._id.toString();
        }

        return cab;
    } catch (error) {
        console.error('❌ getCab error:', error.message);
        return null;
    }
}

/**
 * Create new cab booking
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Cab booking data
 * @param {Object} settings - Hotel settings for price calculation
 * @returns {Object} - Created cab booking
 */
async function createCab(hotelId, data, settings = {}) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateCabBooking(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Calculate price if not provided
        const price = data.price !== undefined ? data.price : calculatePrice(data.type, settings);

        const cab = {
            hotelId,
            guestName: data.guestName.trim(),
            roomNumber: parseInt(data.roomNumber),
            type: data.type,
            pickupTime: data.pickupTime || new Date().toISOString(),
            destination: data.destination || '',
            notes: data.notes || '',
            status: data.status || CAB_STATUS.PENDING,
            price: price,
            driverName: data.driverName || '',
            driverPhone: data.driverPhone || '',
            vehicleNumber: data.vehicleNumber || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _version: 1
        };

        const result = await db.collection('cabs').insertOne(cab);
        cab._id = result.insertedId.toString();

        console.log(`✅ Cab booking created for hotel: ${hotelId} (ID: ${cab._id})`);
        return cab;
    } catch (error) {
        console.error('❌ createCab error:', error.message);
        throw error;
    }
}

/**
 * Update cab booking
 * @param {string} hotelId - Hotel ID
 * @param {string} cabId - Cab booking ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated cab booking
 */
async function updateCab(hotelId, cabId, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const filter = { hotelId };

        if (ObjectId.isValid(cabId)) {
            filter._id = new ObjectId(cabId);
        } else {
            filter._id = cabId;
        }

        // Get current cab
        const currentCab = await db.collection('cabs').findOne(filter);
        if (!currentCab) {
            throw new Error('Cab booking not found');
        }

        // Build update object
        const updateData = { updatedAt: new Date().toISOString() };

        // Update fields if provided
        if (updates.guestName) updateData.guestName = updates.guestName.trim();
        if (updates.roomNumber !== undefined) updateData.roomNumber = parseInt(updates.roomNumber);
        if (updates.type) {
            if (!Object.values(CAB_TYPES).includes(updates.type)) {
                throw new Error(`Invalid cab type. Must be one of: ${Object.values(CAB_TYPES).join(', ')}`);
            }
            updateData.type = updates.type;
        }
        if (updates.pickupTime) updateData.pickupTime = updates.pickupTime;
        if (updates.destination !== undefined) updateData.destination = updates.destination;
        if (updates.notes !== undefined) updateData.notes = updates.notes;
        if (updates.price !== undefined) updateData.price = parseFloat(updates.price);
        if (updates.driverName !== undefined) updateData.driverName = updates.driverName;
        if (updates.driverPhone !== undefined) updateData.driverPhone = updates.driverPhone;
        if (updates.vehicleNumber !== undefined) updateData.vehicleNumber = updates.vehicleNumber;

        // Update status with validation
        if (updates.status) {
            if (!Object.values(CAB_STATUS).includes(updates.status)) {
                throw new Error(`Invalid status. Must be one of: ${Object.values(CAB_STATUS).join(', ')}`);
            }

            if (!isValidStatusTransition(currentCab.status, updates.status)) {
                throw new Error(`Invalid status transition from ${currentCab.status} to ${updates.status}`);
            }

            updateData.status = updates.status;
        }

        const result = await db.collection('cabs').findOneAndUpdate(
            filter,
            { 
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Failed to update cab booking');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Cab booking updated (ID: ${cabId})`);
        return result;
    } catch (error) {
        console.error('❌ updateCab error:', error.message);
        throw error;
    }
}

/**
 * Delete cab booking
 * @param {string} hotelId - Hotel ID
 * @param {string} cabId - Cab booking ID
 * @returns {boolean} - Success status
 */
async function deleteCab(hotelId, cabId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const filter = { hotelId };

        if (ObjectId.isValid(cabId)) {
            filter._id = new ObjectId(cabId);
        } else {
            filter._id = cabId;
        }

        const result = await db.collection('cabs').deleteOne(filter);

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Cab booking not found (ID: ${cabId})`);
            return false;
        }

        console.log(`✅ Cab booking deleted (ID: ${cabId})`);
        return true;
    } catch (error) {
        console.error('❌ deleteCab error:', error.message);
        throw error;
    }
}

/**
 * Delete all cab bookings for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {number} - Number of deleted bookings
 */
async function deleteAllCabs(hotelId) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const result = await db.collection('cabs').deleteMany({ hotelId });

        console.log(`✅ Deleted ${result.deletedCount} cab bookings for hotel: ${hotelId}`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ deleteAllCabs error:', error.message);
        return 0;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================

/**
 * Confirm cab booking
 */
async function confirmCab(hotelId, cabId) {
    return await updateCab(hotelId, cabId, { status: CAB_STATUS.CONFIRMED });
}

/**
 * Mark cab as in progress
 */
async function startCab(hotelId, cabId) {
    return await updateCab(hotelId, cabId, { status: CAB_STATUS.IN_PROGRESS });
}

/**
 * Mark cab as completed
 */
async function completeCab(hotelId, cabId) {
    return await updateCab(hotelId, cabId, { status: CAB_STATUS.COMPLETED });
}

/**
 * Cancel cab booking
 */
async function cancelCab(hotelId, cabId) {
    return await updateCab(hotelId, cabId, { status: CAB_STATUS.CANCELLED });
}

// ============================================================
// SEARCH & FILTER
// ============================================================

/**
 * Search cab bookings
 * @param {string} hotelId - Hotel ID
 * @param {string} query - Search query
 * @returns {Array} - Matching cab bookings
 */
async function searchCabs(hotelId, query) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const searchRegex = new RegExp(query, 'i');

        const cabs = await db.collection('cabs')
            .find({
                hotelId,
                $or: [
                    { guestName: searchRegex },
                    { notes: searchRegex },
                    { driverName: searchRegex },
                    { vehicleNumber: searchRegex },
                    { roomNumber: parseInt(query) || -1 }
                ]
            })
            .sort({ createdAt: -1 })
            .toArray();

        cabs.forEach(cab => {
            if (cab._id) cab._id = cab._id.toString();
        });

        return cabs;
    } catch (error) {
        console.error('❌ searchCabs error:', error.message);
        return [];
    }
}

/**
 * Get cab bookings by room number
 * @param {string} hotelId - Hotel ID
 * @param {number} roomNumber - Room number
 * @returns {Array} - Cab bookings for that room
 */
async function getCabsByRoom(hotelId, roomNumber) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const cabs = await db.collection('cabs')
            .find({ hotelId, roomNumber: parseInt(roomNumber) })
            .sort({ createdAt: -1 })
            .toArray();

        cabs.forEach(cab => {
            if (cab._id) cab._id = cab._id.toString();
        });

        return cabs;
    } catch (error) {
        console.error('❌ getCabsByRoom error:', error.message);
        return [];
    }
}

/**
 * Get cab bookings by status
 * @param {string} hotelId - Hotel ID
 * @param {string} status - Status to filter
 * @returns {Array} - Cab bookings with that status
 */
async function getCabsByStatus(hotelId, status) {
    if (!Object.values(CAB_STATUS).includes(status)) {
        throw new Error(`Invalid status. Must be one of: ${Object.values(CAB_STATUS).join(', ')}`);
    }

    return await getCabs(hotelId, { status });
}

/**
 * Get today's cab bookings
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Today's cab bookings
 */
async function getTodayCabs(hotelId) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const cabs = await db.collection('cabs')
            .find({
                hotelId,
                createdAt: {
                    $gte: today.toISOString(),
                    $lt: tomorrow.toISOString()
                }
            })
            .sort({ createdAt: -1 })
            .toArray();

        cabs.forEach(cab => {
            if (cab._id) cab._id = cab._id.toString();
        });

        return cabs;
    } catch (error) {
        console.error('❌ getTodayCabs error:', error.message);
        return [];
    }
}

/**
 * Get pending cab bookings
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Pending cab bookings
 */
async function getPendingCabs(hotelId) {
    return await getCabsByStatus(hotelId, CAB_STATUS.PENDING);
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get cab booking statistics
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Statistics
 */
async function getCabStats(hotelId) {
    try {
        if (!isConnected()) {
            return { total: 0, revenue: 0, byStatus: {}, byType: {}, today: 0 };
        }

        const db = getDB();
        if (!db) {
            return { total: 0, revenue: 0, byStatus: {}, byType: {}, today: 0 };
        }

        const cabs = await db.collection('cabs')
            .find({ hotelId })
            .toArray();

        // Calculate statistics
        const totalBookings = cabs.length;
        const totalRevenue = cabs
            .filter(cab => cab.status === CAB_STATUS.COMPLETED)
            .reduce((sum, cab) => sum + (cab.price || 0), 0);

        // Count by status
        const byStatus = {};
        cabs.forEach(cab => {
            const status = cab.status || 'unknown';
            byStatus[status] = (byStatus[status] || 0) + 1;
        });

        // Count by type
        const byType = {};
        cabs.forEach(cab => {
            const type = cab.type || 'unknown';
            byType[type] = (byType[type] || 0) + 1;
        });

        // Today's bookings
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayCount = cabs.filter(cab => {
            const cabDate = new Date(cab.createdAt);
            return cabDate >= today;
        }).length;

        return {
            total: totalBookings,
            revenue: totalRevenue,
            byStatus,
            byType,
            today: todayCount,
            pending: byStatus[CAB_STATUS.PENDING] || 0,
            completed: byStatus[CAB_STATUS.COMPLETED] || 0,
            cancelled: byStatus[CAB_STATUS.CANCELLED] || 0
        };
    } catch (error) {
        console.error('❌ getCabStats error:', error.message);
        return { total: 0, revenue: 0, byStatus: {}, byType: {}, today: 0 };
    }
}

/**
 * Get cab booking count
 * @param {string} hotelId - Hotel ID
 * @param {Object} filters - Optional filters
 * @returns {number} - Count
 */
async function getCabCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const query = { hotelId };

        if (filters.status) query.status = filters.status;
        if (filters.type) query.type = filters.type;

        return await db.collection('cabs').countDocuments(query);
    } catch (error) {
        console.error('❌ getCabCount error:', error.message);
        return 0;
    }
}

/**
 * Get revenue by cab type
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Revenue breakdown by type
 */
async function getRevenueByType(hotelId) {
    try {
        if (!isConnected()) return { airport: 0, local: 0, total: 0 };

        const db = getDB();
        if (!db) return { airport: 0, local: 0, total: 0 };

        const cabs = await db.collection('cabs')
            .find({
                hotelId,
                status: CAB_STATUS.COMPLETED
            })
            .toArray();

        const airportRevenue = cabs
            .filter(cab => cab.type === CAB_TYPES.AIRPORT)
            .reduce((sum, cab) => sum + (cab.price || 0), 0);

        const localRevenue = cabs
            .filter(cab => cab.type === CAB_TYPES.LOCAL)
            .reduce((sum, cab) => sum + (cab.price || 0), 0);

        return {
            airport: airportRevenue,
            local: localRevenue,
            total: airportRevenue + localRevenue
        };
    } catch (error) {
        console.error('❌ getRevenueByType error:', error.message);
        return { airport: 0, local: 0, total: 0 };
    }
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for cabs collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound index for hotel + status queries
        await db.collection('cabs').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );

        // Index for room-based queries
        await db.collection('cabs').createIndex(
            { hotelId: 1, roomNumber: 1 },
            { background: true, name: 'hotelId_roomNumber_idx' }
        );

        // Index for type-based queries
        await db.collection('cabs').createIndex(
            { hotelId: 1, type: 1 },
            { background: true, name: 'hotelId_type_idx' }
        );

        // Index for sorting by creation date
        await db.collection('cabs').createIndex(
            { createdAt: -1 },
            { background: true, name: 'createdAt_idx' }
        );

        // Index for guest name searches
        await db.collection('cabs').createIndex(
            { hotelId: 1, guestName: 1 },
            { background: true, name: 'hotelId_guestName_idx' }
        );

        console.log('✅ Cab indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    CAB_TYPES,
    CAB_STATUS,

    // CRUD operations
    getCabs,
    getCab,
    createCab,
    updateCab,
    deleteCab,
    deleteAllCabs,

    // Status management
    confirmCab,
    startCab,
    completeCab,
    cancelCab,

    // Search & filter
    searchCabs,
    getCabsByRoom,
    getCabsByStatus,
    getTodayCabs,
    getPendingCabs,

    // Statistics
    getCabStats,
    getCabCount,
    getRevenueByType,

    // Helpers
    validateCabBooking,
    isValidStatusTransition,
    calculatePrice,

    // Index management
    createIndexes
};