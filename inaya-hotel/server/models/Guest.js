// server/utils/guestHelpers.js
// Guest Management Helpers - Native MongoDB Compatible
// Features: Complete CRUD, Loyalty Points, Check-in/out, VIP Status, Bulk Operations
// Compatible with index.html (19 admin pages + 9 guest pages)

const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Guest status options
 */
const GUEST_STATUS = {
    ACTIVE: 'active',
    CHECKED_IN: 'checked_in',
    CHECKED_OUT: 'checked_out',
    VIP: 'vip',
    BLACKLISTED: 'blacklisted',
    INACTIVE: 'inactive'
};

/**
 * Guest types
 */
const GUEST_TYPES = {
    REGULAR: 'regular',
    RETURNING: 'returning',
    VIP: 'vip',
    CORPORATE: 'corporate'
};

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate guest data
 * @param {Object} data - Guest data
 * @param {boolean} isUpdate - Whether this is an update operation
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateGuest(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.name || data.name.trim() === '') {
            errors.push('Guest name is required');
        }

        if (data.room === undefined || data.room === null) {
            errors.push('Room number is required');
        }
    }

    // Validate email if provided
    if (data.email && data.email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
            errors.push('Invalid email format');
        }
    }

    // Validate phone if provided
    if (data.phone && data.phone.trim() !== '') {
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(data.phone)) {
            errors.push('Invalid phone format');
        }
    }

    // Validate points
    if (data.points !== undefined && (isNaN(data.points) || data.points < 0)) {
        errors.push('Points must be a non-negative number');
    }

    // Validate status
    if (data.status && !Object.values(GUEST_STATUS).includes(data.status)) {
        errors.push(`Invalid status. Must be one of: ${Object.values(GUEST_STATUS).join(', ')}`);
    }

    // Validate guest type
    if (data.guestType && !Object.values(GUEST_TYPES).includes(data.guestType)) {
        errors.push(`Invalid guest type. Must be one of: ${Object.values(GUEST_TYPES).join(', ')}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for guests collection
 * @param {Object} db - MongoDB database instance
 */
async function createGuestIndexes(db) {
    try {
        const collection = db.collection('guests');

        await collection.createIndex({ hotelId: 1 }, { background: true });

        // Unique email per hotel (sparse allows null/missing emails)
        await collection.createIndex(
            { hotelId: 1, email: 1 }, 
            { unique: true, sparse: true, background: true }
        );

        // Room lookup index
        await collection.createIndex(
            { hotelId: 1, room: 1 }, 
            { background: true }
        );

        // Status index
        await collection.createIndex(
            { hotelId: 1, status: 1 }, 
            { background: true }
        );

        // Points index (for loyalty program)
        await collection.createIndex(
            { hotelId: 1, points: -1 }, 
            { background: true }
        );

        // Check-in date index
        await collection.createIndex(
            { hotelId: 1, checkInDate: -1 }, 
            { background: true }
        );

        // Soft delete index
        await collection.createIndex(
            { hotelId: 1, isDeleted: 1 }, 
            { background: true }
        );

        console.log('✅ Guest indexes created');
    } catch (error) {
        console.error('⚠️ Guest index creation failed:', error.message);
    }
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Create a new guest record
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} guestData - Guest data
 * @returns {Object} - Created guest
 */
async function createGuest(db, hotelId, guestData) {
    try {
        // Validate data
        const validation = validateGuest(guestData);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check for duplicate email if provided
        if (guestData.email) {
            const existing = await db.collection('guests').findOne({ 
                hotelId, 
                email: guestData.email.trim().toLowerCase(),
                isDeleted: { $ne: true }
            });
            if (existing) {
                throw new Error('A guest with this email already exists for this hotel');
            }
        }

        const newGuest = {
            hotelId,
            name: guestData.name.trim(),
            room: parseInt(guestData.room),
            email: guestData.email ? guestData.email.trim().toLowerCase() : null,
            phone: guestData.phone ? guestData.phone.trim() : null,
            nationality: guestData.nationality || '',
            idProof: guestData.idProof || '',
            address: guestData.address || '',

            // Dates
            checkInDate: guestData.checkInDate ? new Date(guestData.checkInDate) : new Date(),
            checkOutDate: guestData.checkOutDate ? new Date(guestData.checkOutDate) : null,
            actualCheckIn: null,
            actualCheckOut: null,

            // Status & Type
            status: guestData.status || GUEST_STATUS.ACTIVE,
            guestType: guestData.guestType || GUEST_TYPES.REGULAR,
            isVIP: guestData.isVIP || false,

            // Loyalty
            points: parseInt(guestData.points) || 0,
            totalVisits: guestData.totalVisits || 1,
            lastVisitDate: new Date(),

            // Preferences
            preferences: guestData.preferences || {},
            notes: guestData.notes || '',

            // Blacklist
            isBlacklisted: guestData.isBlacklisted || false,
            blacklistReason: guestData.blacklistReason || '',

            // Metadata
            _version: 1,
            isDeleted: false,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('guests').insertOne(newGuest);
        newGuest._id = result.insertedId.toString();

        console.log(`✅ Guest created for hotel: ${hotelId} (ID: ${newGuest._id})`);
        return newGuest;
    } catch (error) {
        console.error('❌ createGuest error:', error.message);
        throw error;
    }
}

/**
 * Fetch a single guest by ID
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @returns {Object|null} - Guest or null
 */
async function getGuestById(db, hotelId, guestId) {
    try {
        if (!ObjectId.isValid(guestId)) return null;

        const guest = await db.collection('guests').findOne({ 
            _id: new ObjectId(guestId), 
            hotelId,
            isDeleted: { $ne: true }
        });

        if (guest && guest._id) {
            guest._id = guest._id.toString();
        }

        return guest;
    } catch (error) {
        console.error('❌ getGuestById error:', error.message);
        return null;
    }
}

/**
 * Fetch a list of guests with filtering and pagination
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} options - Filter options
 * @returns {Object} - { guests, total, page, limit, pages }
 */
async function getGuests(db, hotelId, options = {}) {
    try {
        const { search, limit = 50, page = 1, status, room, guestType, isVIP } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };

        if (status) filter.status = status;
        if (room) filter.room = parseInt(room);
        if (guestType) filter.guestType = guestType;
        if (isVIP !== undefined) filter.isVIP = isVIP === 'true' || isVIP === true;

        // Search across name, email, phone, or room
        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phone: searchRegex },
                { room: parseInt(search) || -1 }
            ];
        }

        const skip = (page - 1) * limit;

        const [guests, total] = await Promise.all([
            db.collection('guests')
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('guests').countDocuments(filter)
        ]);

        // Convert ObjectIds to strings
        guests.forEach(guest => {
            if (guest._id) guest._id = guest._id.toString();
        });

        return { 
            guests, 
            total, 
            page, 
            limit, 
            pages: Math.ceil(total / limit) 
        };
    } catch (error) {
        console.error('❌ getGuests error:', error.message);
        return { guests: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

/**
 * Update an existing guest record
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated guest
 */
async function updateGuest(db, hotelId, guestId, updates) {
    try {
        if (!ObjectId.isValid(guestId)) {
            throw new Error('Invalid Guest ID');
        }

        // Get current guest
        const currentGuest = await db.collection('guests').findOne({
            _id: new ObjectId(guestId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!currentGuest) {
            throw new Error('Guest not found');
        }

        // Validate updates
        const validation = validateGuest(updates, true);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check for duplicate email if email is being changed
        if (updates.email && updates.email !== currentGuest.email) {
            const existing = await db.collection('guests').findOne({
                hotelId,
                email: updates.email.trim().toLowerCase(),
                _id: { $ne: new ObjectId(guestId) },
                isDeleted: { $ne: true }
            });
            if (existing) {
                throw new Error('A guest with this email already exists for this hotel');
            }
        }

        // Build clean update object
        const cleanUpdates = { updatedAt: new Date() };

        if (updates.name) cleanUpdates.name = updates.name.trim();
        if (updates.room !== undefined) cleanUpdates.room = parseInt(updates.room);
        if (updates.email !== undefined) {
            cleanUpdates.email = updates.email ? updates.email.trim().toLowerCase() : null;
        }
        if (updates.phone !== undefined) {
            cleanUpdates.phone = updates.phone ? updates.phone.trim() : null;
        }
        if (updates.nationality !== undefined) cleanUpdates.nationality = updates.nationality;
        if (updates.idProof !== undefined) cleanUpdates.idProof = updates.idProof;
        if (updates.address !== undefined) cleanUpdates.address = updates.address;
        if (updates.checkInDate) cleanUpdates.checkInDate = new Date(updates.checkInDate);
        if (updates.checkOutDate !== undefined) {
            cleanUpdates.checkOutDate = updates.checkOutDate ? new Date(updates.checkOutDate) : null;
        }
        if (updates.status) cleanUpdates.status = updates.status;
        if (updates.guestType) cleanUpdates.guestType = updates.guestType;
        if (updates.isVIP !== undefined) cleanUpdates.isVIP = updates.isVIP;
        if (updates.preferences !== undefined) cleanUpdates.preferences = updates.preferences;
        if (updates.notes !== undefined) cleanUpdates.notes = updates.notes;
        if (updates.isBlacklisted !== undefined) cleanUpdates.isBlacklisted = updates.isBlacklisted;
        if (updates.blacklistReason !== undefined) cleanUpdates.blacklistReason = updates.blacklistReason;

        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId },
            { 
                $set: cleanUpdates,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Failed to update guest');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Guest updated (ID: ${guestId})`);
        return result;
    } catch (error) {
        console.error('❌ updateGuest error:', error.message);
        throw error;
    }
}

/**
 * Delete a guest record (soft delete)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @returns {boolean} - Success status
 */
async function deleteGuest(db, hotelId, guestId) {
    try {
        if (!ObjectId.isValid(guestId)) {
            throw new Error('Invalid Guest ID');
        }

        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId, isDeleted: { $ne: true } },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    status: GUEST_STATUS.INACTIVE,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            console.warn(`⚠️ Guest not found (ID: ${guestId})`);
            return false;
        }

        console.log(`✅ Guest deleted (soft) (ID: ${guestId})`);
        return true;
    } catch (error) {
        console.error('❌ deleteGuest error:', error.message);
        throw error;
    }
}

/**
 * Permanently delete a guest record (hard delete)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @returns {boolean} - Success status
 */
async function permanentlyDeleteGuest(db, hotelId, guestId) {
    try {
        if (!ObjectId.isValid(guestId)) {
            throw new Error('Invalid Guest ID');
        }

        const result = await db.collection('guests').deleteOne({
            _id: new ObjectId(guestId),
            hotelId
        });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Guest not found (ID: ${guestId})`);
            return false;
        }

        console.log(`✅ Guest permanently deleted (ID: ${guestId})`);
        return true;
    } catch (error) {
        console.error('❌ permanentlyDeleteGuest error:', error.message);
        throw error;
    }
}

// ============================================================
// CHECK-IN / CHECK-OUT
// ============================================================

/**
 * Check in a guest
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @returns {Object} - Updated guest
 */
async function checkInGuest(db, hotelId, guestId) {
    try {
        return await updateGuest(db, hotelId, guestId, {
            status: GUEST_STATUS.CHECKED_IN,
            actualCheckIn: new Date()
        });
    } catch (error) {
        console.error('❌ checkInGuest error:', error.message);
        throw error;
    }
}

/**
 * Check out a guest
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @returns {Object} - Updated guest
 */
async function checkOutGuest(db, hotelId, guestId) {
    try {
        return await updateGuest(db, hotelId, guestId, {
            status: GUEST_STATUS.CHECKED_OUT,
            actualCheckOut: new Date()
        });
    } catch (error) {
        console.error('❌ checkOutGuest error:', error.message);
        throw error;
    }
}

// ============================================================
// LOYALTY POINTS
// ============================================================

/**
 * Add loyalty points to a guest (Atomic Operation)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @param {number} amount - Points to add
 * @returns {Object} - Updated guest
 */
async function addPoints(db, hotelId, guestId, amount) {
    try {
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Points amount must be a positive number');
        }

        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId, isDeleted: { $ne: true } },
            { 
                $inc: { points: amount },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Guest not found');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Added ${amount} points to guest (ID: ${guestId})`);
        return result;
    } catch (error) {
        console.error('❌ addPoints error:', error.message);
        throw error;
    }
}

/**
 * Redeem (subtract) loyalty points (Check balance first)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} guestId - Guest ID
 * @param {number} amount - Points to redeem
 * @returns {Object} - Updated guest
 */
async function redeemPoints(db, hotelId, guestId, amount) {
    try {
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Points amount must be a positive number');
        }

        // Check current balance
        const guest = await db.collection('guests').findOne({ 
            _id: new ObjectId(guestId), 
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!guest) {
            throw new Error('Guest not found');
        }

        if (guest.points < amount) {
            throw new Error(`Insufficient points balance. Current: ${guest.points}, Required: ${amount}`);
        }

        // Perform deduction atomically
        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId },
            { 
                $inc: { points: -amount },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Redeemed ${amount} points from guest (ID: ${guestId})`);
        return result;
    } catch (error) {
        console.error('❌ redeemPoints error:', error.message);
        throw error;
    }
}

/**
 * Get top guests by points (loyalty leaderboard)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {number} limit - Number of guests to return
 * @returns {Array} - Top guests
 */
async function getTopGuests(db, hotelId, limit = 10) {
    try {
        const guests = await db.collection('guests')
            .find({ 
                hotelId, 
                isDeleted: { $ne: true },
                points: { $gt: 0 }
            })
            .sort({ points: -1 })
            .limit(limit)
            .toArray();

        guests.forEach(guest => {
            if (guest._id) guest._id = guest._id.toString();
        });

        return guests;
    } catch (error) {
        console.error('❌ getTopGuests error:', error.message);
        return [];
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================

/**
 * Find guest by email
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} email - Guest email
 * @returns {Object|null} - Guest or null
 */
async function getGuestByEmail(db, hotelId, email) {
    try {
        if (!email) return null;

        const guest = await db.collection('guests').findOne({ 
            hotelId, 
            email: email.trim().toLowerCase(),
            isDeleted: { $ne: true }
        });

        if (guest && guest._id) {
            guest._id = guest._id.toString();
        }

        return guest;
    } catch (error) {
        console.error('❌ getGuestByEmail error:', error.message);
        return null;
    }
}

/**
 * Find guest by room number
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {number} roomNumber - Room number
 * @returns {Array} - Guests in that room
 */
async function getGuestsByRoom(db, hotelId, roomNumber) {
    try {
        const guests = await db.collection('guests')
            .find({ 
                hotelId, 
                room: parseInt(roomNumber),
                isDeleted: { $ne: true }
            })
            .sort({ createdAt: -1 })
            .toArray();

        guests.forEach(guest => {
            if (guest._id) guest._id = guest._id.toString();
        });

        return guests;
    } catch (error) {
        console.error('❌ getGuestsByRoom error:', error.message);
        return [];
    }
}

/**
 * Get currently checked-in guests
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Checked-in guests
 */
async function getCheckedInGuests(db, hotelId) {
    try {
        const guests = await db.collection('guests')
            .find({ 
                hotelId, 
                status: GUEST_STATUS.CHECKED_IN,
                isDeleted: { $ne: true }
            })
            .sort({ actualCheckIn: -1 })
            .toArray();

        guests.forEach(guest => {
            if (guest._id) guest._id = guest._id.toString();
        });

        return guests;
    } catch (error) {
        console.error('❌ getCheckedInGuests error:', error.message);
        return [];
    }
}

/**
 * Get VIP guests
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - VIP guests
 */
async function getVIPGuests(db, hotelId) {
    try {
        const guests = await db.collection('guests')
            .find({ 
                hotelId, 
                isVIP: true,
                isDeleted: { $ne: true }
            })
            .sort({ points: -1 })
            .toArray();

        guests.forEach(guest => {
            if (guest._id) guest._id = guest._id.toString();
        });

        return guests;
    } catch (error) {
        console.error('❌ getVIPGuests error:', error.message);
        return [];
    }
}

// ============================================================
// BULK OPERATIONS
// ============================================================

/**
 * Bulk create guests
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} guestsData - Array of guest data
 * @returns {Object} - { created: number, failed: number, errors: string[] }
 */
async function bulkCreateGuests(db, hotelId, guestsData) {
    try {
        if (!Array.isArray(guestsData) || guestsData.length === 0) {
            throw new Error('guestsData must be a non-empty array');
        }

        let created = 0;
        let failed = 0;
        const errors = [];

        for (const guestData of guestsData) {
            try {
                await createGuest(db, hotelId, guestData);
                created++;
            } catch (error) {
                failed++;
                errors.push(`${guestData.name || 'Unknown'}: ${error.message}`);
            }
        }

        console.log(`✅ Bulk create: ${created} created, ${failed} failed`);
        return { created, failed, errors };
    } catch (error) {
        console.error('❌ bulkCreateGuests error:', error.message);
        throw error;
    }
}

/**
 * Bulk add points to multiple guests
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} guestIds - Array of guest IDs
 * @param {number} points - Points to add
 * @returns {Object} - { updated: number, failed: number }
 */
async function bulkAddPoints(db, hotelId, guestIds, points) {
    try {
        if (!Array.isArray(guestIds) || guestIds.length === 0) {
            throw new Error('guestIds must be a non-empty array');
        }

        const validIds = guestIds
            .filter(id => ObjectId.isValid(id))
            .map(id => new ObjectId(id));

        const result = await db.collection('guests').updateMany(
            { 
                _id: { $in: validIds }, 
                hotelId,
                isDeleted: { $ne: true }
            },
            { 
                $inc: { points },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        console.log(`✅ Bulk add points: ${result.modifiedCount} updated`);
        return { 
            updated: result.modifiedCount, 
            failed: guestIds.length - result.modifiedCount 
        };
    } catch (error) {
        console.error('❌ bulkAddPoints error:', error.message);
        throw error;
    }
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get guest statistics for dashboard
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Statistics
 */
async function getGuestStats(db, hotelId) {
    try {
        const stats = await db.collection('guests').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$status', GUEST_STATUS.ACTIVE] }, 1, 0] } },
                    checkedIn: { $sum: { $cond: [{ $eq: ['$status', GUEST_STATUS.CHECKED_IN] }, 1, 0] } },
                    checkedOut: { $sum: { $cond: [{ $eq: ['$status', GUEST_STATUS.CHECKED_OUT] }, 1, 0] } },
                    vip: { $sum: { $cond: ['$isVIP', 1, 0] } },
                    blacklisted: { $sum: { $cond: ['$isBlacklisted', 1, 0] } },
                    totalPoints: { $sum: '$points' },
                    avgPoints: { $avg: '$points' },
                    avgVisits: { $avg: '$totalVisits' }
                }
            }
        ]).toArray();

        const result = stats[0] || {
            total: 0,
            active: 0,
            checkedIn: 0,
            checkedOut: 0,
            vip: 0,
            blacklisted: 0,
            totalPoints: 0,
            avgPoints: 0,
            avgVisits: 0
        };

        return {
            total: result.total,
            active: result.active,
            checkedIn: result.checkedIn,
            checkedOut: result.checkedOut,
            vip: result.vip,
            blacklisted: result.blacklisted,
            totalPoints: result.totalPoints,
            avgPoints: result.avgPoints ? result.avgPoints.toFixed(2) : 0,
            avgVisits: result.avgVisits ? result.avgVisits.toFixed(2) : 0
        };
    } catch (error) {
        console.error('❌ getGuestStats error:', error.message);
        return {
            total: 0,
            active: 0,
            checkedIn: 0,
            checkedOut: 0,
            vip: 0,
            blacklisted: 0,
            totalPoints: 0,
            avgPoints: 0,
            avgVisits: 0
        };
    }
}

/**
 * Get guest count
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} filters - Filter options
 * @returns {number} - Count
 */
async function getGuestCount(db, hotelId, filters = {}) {
    try {
        const query = { hotelId, isDeleted: { $ne: true } };

        if (filters.status) query.status = filters.status;
        if (filters.isVIP !== undefined) query.isVIP = filters.isVIP;
        if (filters.room) query.room = parseInt(filters.room);

        return await db.collection('guests').countDocuments(query);
    } catch (error) {
        console.error('❌ getGuestCount error:', error.message);
        return 0;
    }
}

// ============================================================
// EXPORT
// ============================================================

/**
 * Export guest list
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} options - Export options
 * @returns {string|Array} - Exported data
 */
async function exportGuests(db, hotelId, options = {}) {
    try {
        const { status, format = 'json' } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };
        if (status) filter.status = status;

        const guests = await db.collection('guests')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Name', 'Room', 'Email', 'Phone', 'Status', 'Points', 'VIP', 'Check-in', 'Check-out'];
            const rows = guests.map(g => [
                g.name,
                g.room,
                g.email || '',
                g.phone || '',
                g.status,
                g.points,
                g.isVIP ? 'Yes' : 'No',
                g.checkInDate ? new Date(g.checkInDate).toISOString().split('T')[0] : '',
                g.checkOutDate ? new Date(g.checkOutDate).toISOString().split('T')[0] : ''
            ]);

            return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        }

        return guests.map(g => ({
            ...g,
            _id: g._id?.toString()
        }));
    } catch (error) {
        console.error('❌ exportGuests error:', error.message);
        return format === 'csv' ? '' : [];
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    GUEST_STATUS,
    GUEST_TYPES,

    // Index management
    createGuestIndexes,

    // CRUD operations
    createGuest,
    getGuestById,
    getGuests,
    updateGuest,
    deleteGuest,
    permanentlyDeleteGuest,

    // Check-in/Check-out
    checkInGuest,
    checkOutGuest,

    // Loyalty points
    addPoints,
    redeemPoints,
    getTopGuests,

    // Search & filter
    getGuestByEmail,
    getGuestsByRoom,
    getCheckedInGuests,
    getVIPGuests,

    // Bulk operations
    bulkCreateGuests,
    bulkAddPoints,

    // Statistics
    getGuestStats,
    getGuestCount,

    // Export
    exportGuests,

    // Helpers
    validateGuest
};