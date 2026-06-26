// server/models/Blacklist.js
// Blacklist Management Model - Native MongoDB Compatible
// Features: Complete CRUD, Search, Validation, Real-time Sync, Analytics
// Compatible with index.html (19 admin pages + 9 guest pages)

const { getDB, isConnected } = require('../config/db');

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate blacklist entry data
 * @param {Object} data - Entry data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateBlacklistEntry(data) {
    const errors = [];

    if (!data.name || data.name.trim() === '') {
        errors.push('Guest name is required');
    }

    if (!data.reason || data.reason.trim() === '') {
        errors.push('Reason for blocking is required');
    }

    if (data.room !== undefined && data.room !== null) {
        const roomNum = parseInt(data.room);
        if (isNaN(roomNum) || roomNum <= 0) {
            errors.push('Room number must be a positive integer');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Normalize guest name for consistent matching
 * @param {string} name - Guest name
 * @returns {string} - Normalized name
 */
function normalizeGuestName(name) {
    if (!name) return '';
    return name.trim().toLowerCase();
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all blacklist entries for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Array of blacklist entries
 */
async function getBlacklist(hotelId) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const entries = await db.collection('blacklist')
            .find({ hotelId })
            .sort({ blockedAt: -1 })
            .toArray();

        // Convert ObjectIds to strings
        entries.forEach(entry => {
            if (entry._id) entry._id = entry._id.toString();
        });

        return entries;
    } catch (error) {
        console.error('❌ getBlacklist error:', error.message);
        return [];
    }
}

/**
 * Get single blacklist entry by ID
 * @param {string} hotelId - Hotel ID
 * @param {string} entryId - Entry ID
 * @returns {Object|null} - Entry or null
 */
async function getBlacklistEntry(hotelId, entryId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const { ObjectId } = require('mongodb');
        const filter = { hotelId };

        if (ObjectId.isValid(entryId)) {
            filter._id = new ObjectId(entryId);
        } else {
            filter._id = entryId;
        }

        const entry = await db.collection('blacklist').findOne(filter);

        if (entry && entry._id) {
            entry._id = entry._id.toString();
        }

        return entry;
    } catch (error) {
        console.error('❌ getBlacklistEntry error:', error.message);
        return null;
    }
}

/**
 * Add guest to blacklist
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Entry data
 * @returns {Object} - Created entry
 */
async function addToBlacklist(hotelId, data) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateBlacklistEntry(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if already blacklisted
        const existing = await isBlacklisted(hotelId, data.name);
        if (existing) {
            throw new Error(`Guest "${data.name}" is already blacklisted`);
        }

        const entry = {
            hotelId,
            name: data.name.trim(),
            reason: data.reason.trim(),
            room: data.room ? parseInt(data.room) : null,
            blockedBy: data.blockedBy || 'system',
            blockedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('blacklist').insertOne(entry);
        entry._id = result.insertedId.toString();

        console.log(`✅ Guest added to blacklist: ${entry.name} (Hotel: ${hotelId})`);
        return entry;
    } catch (error) {
        console.error('❌ addToBlacklist error:', error.message);
        throw error;
    }
}

/**
 * Update blacklist entry
 * @param {string} hotelId - Hotel ID
 * @param {string} entryId - Entry ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated entry
 */
async function updateBlacklistEntry(hotelId, entryId, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const { ObjectId } = require('mongodb');
        const filter = { hotelId };

        if (ObjectId.isValid(entryId)) {
            filter._id = new ObjectId(entryId);
        } else {
            filter._id = entryId;
        }

        const updateData = { updatedAt: new Date() };

        if (updates.name) updateData.name = updates.name.trim();
        if (updates.reason) updateData.reason = updates.reason.trim();
        if (updates.room !== undefined) {
            updateData.room = updates.room ? parseInt(updates.room) : null;
        }
        if (updates.blockedBy) updateData.blockedBy = updates.blockedBy;

        const result = await db.collection('blacklist').findOneAndUpdate(
            filter,
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Blacklist entry not found');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Blacklist entry updated (ID: ${entryId})`);
        return result;
    } catch (error) {
        console.error('❌ updateBlacklistEntry error:', error.message);
        throw error;
    }
}

/**
 * Remove guest from blacklist
 * @param {string} hotelId - Hotel ID
 * @param {string} entryId - Entry ID
 * @returns {boolean} - Success status
 */
async function removeFromBlacklist(hotelId, entryId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const { ObjectId } = require('mongodb');
        const filter = { hotelId };

        if (ObjectId.isValid(entryId)) {
            filter._id = new ObjectId(entryId);
        } else {
            filter._id = entryId;
        }

        const result = await db.collection('blacklist').deleteOne(filter);

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Blacklist entry not found (ID: ${entryId})`);
            return false;
        }

        console.log(`✅ Guest removed from blacklist (ID: ${entryId})`);
        return true;
    } catch (error) {
        console.error('❌ removeFromBlacklist error:', error.message);
        throw error;
    }
}

/**
 * Remove all blacklist entries for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {number} - Number of deleted entries
 */
async function clearBlacklist(hotelId) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const result = await db.collection('blacklist').deleteMany({ hotelId });

        console.log(`✅ Cleared ${result.deletedCount} blacklist entries for hotel: ${hotelId}`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ clearBlacklist error:', error.message);
        return 0;
    }
}

// ============================================================
// SEARCH & CHECK FUNCTIONS
// ============================================================

/**
 * Check if guest is blacklisted
 * @param {string} hotelId - Hotel ID
 * @param {string} guestName - Guest name to check
 * @returns {Object|null} - Blacklist entry or null
 */
async function isBlacklisted(hotelId, guestName) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const normalizedName = normalizeGuestName(guestName);

        const entry = await db.collection('blacklist').findOne({
            hotelId,
            $or: [
                { name: { $regex: new RegExp(`^${guestName}$`, 'i') } },
                { name: { $regex: new RegExp(`^${normalizedName}$`, 'i') } }
            ]
        });

        if (entry && entry._id) {
            entry._id = entry._id.toString();
        }

        return entry;
    } catch (error) {
        console.error('❌ isBlacklisted error:', error.message);
        return null;
    }
}

/**
 * Search blacklist entries
 * @param {string} hotelId - Hotel ID
 * @param {string} query - Search query
 * @returns {Array} - Matching entries
 */
async function searchBlacklist(hotelId, query) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const searchRegex = new RegExp(query, 'i');

        const entries = await db.collection('blacklist')
            .find({
                hotelId,
                $or: [
                    { name: searchRegex },
                    { reason: searchRegex },
                    { room: parseInt(query) || -1 }
                ]
            })
            .sort({ blockedAt: -1 })
            .toArray();

        entries.forEach(entry => {
            if (entry._id) entry._id = entry._id.toString();
        });

        return entries;
    } catch (error) {
        console.error('❌ searchBlacklist error:', error.message);
        return [];
    }
}

/**
 * Get blacklist entries by room number
 * @param {string} hotelId - Hotel ID
 * @param {number} roomNumber - Room number
 * @returns {Array} - Entries for that room
 */
async function getBlacklistByRoom(hotelId, roomNumber) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const entries = await db.collection('blacklist')
            .find({ hotelId, room: parseInt(roomNumber) })
            .sort({ blockedAt: -1 })
            .toArray();

        entries.forEach(entry => {
            if (entry._id) entry._id = entry._id.toString();
        });

        return entries;
    } catch (error) {
        console.error('❌ getBlacklistByRoom error:', error.message);
        return [];
    }
}

/**
 * Get blacklist entries by admin who blocked
 * @param {string} hotelId - Hotel ID
 * @param {string} blockedBy - Admin email
 * @returns {Array} - Entries blocked by that admin
 */
async function getBlacklistByAdmin(hotelId, blockedBy) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const entries = await db.collection('blacklist')
            .find({ hotelId, blockedBy })
            .sort({ blockedAt: -1 })
            .toArray();

        entries.forEach(entry => {
            if (entry._id) entry._id = entry._id.toString();
        });

        return entries;
    } catch (error) {
        console.error('❌ getBlacklistByAdmin error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get blacklist statistics for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Statistics
 */
async function getBlacklistStats(hotelId) {
    try {
        if (!isConnected()) {
            return { total: 0, byRoom: {}, byAdmin: {}, recent: [] };
        }

        const db = getDB();
        if (!db) {
            return { total: 0, byRoom: {}, byAdmin: {}, recent: [] };
        }

        const entries = await db.collection('blacklist')
            .find({ hotelId })
            .toArray();

        // Count by room
        const byRoom = {};
        entries.forEach(entry => {
            const room = entry.room || 'No Room';
            byRoom[room] = (byRoom[room] || 0) + 1;
        });

        // Count by admin
        const byAdmin = {};
        entries.forEach(entry => {
            const admin = entry.blockedBy || 'system';
            byAdmin[admin] = (byAdmin[admin] || 0) + 1;
        });

        // Recent entries (last 10)
        const recent = entries
            .sort((a, b) => new Date(b.blockedAt) - new Date(a.blockedAt))
            .slice(0, 10)
            .map(entry => {
                if (entry._id) entry._id = entry._id.toString();
                return entry;
            });

        return {
            total: entries.length,
            byRoom,
            byAdmin,
            recent
        };
    } catch (error) {
        console.error('❌ getBlacklistStats error:', error.message);
        return { total: 0, byRoom: {}, byAdmin: {}, recent: [] };
    }
}

/**
 * Get blacklist count for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {number} - Count
 */
async function getBlacklistCount(hotelId) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        return await db.collection('blacklist').countDocuments({ hotelId });
    } catch (error) {
        console.error('❌ getBlacklistCount error:', error.message);
        return 0;
    }
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for blacklist collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound index for hotel + name queries
        await db.collection('blacklist').createIndex(
            { hotelId: 1, name: 1 },
            { background: true, name: 'hotelId_name_idx' }
        );

        // Index for room-based queries
        await db.collection('blacklist').createIndex(
            { hotelId: 1, room: 1 },
            { background: true, name: 'hotelId_room_idx' }
        );

        // Index for admin-based queries
        await db.collection('blacklist').createIndex(
            { hotelId: 1, blockedBy: 1 },
            { background: true, name: 'hotelId_blockedBy_idx' }
        );

        // Index for sorting by blocked date
        await db.collection('blacklist').createIndex(
            { blockedAt: -1 },
            { background: true, name: 'blockedAt_idx' }
        );

        console.log('✅ Blacklist indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // CRUD operations
    getBlacklist,
    getBlacklistEntry,
    addToBlacklist,
    updateBlacklistEntry,
    removeFromBlacklist,
    clearBlacklist,

    // Search & check
    isBlacklisted,
    searchBlacklist,
    getBlacklistByRoom,
    getBlacklistByAdmin,

    // Statistics
    getBlacklistStats,
    getBlacklistCount,

    // Helpers
    validateBlacklistEntry,
    normalizeGuestName,

    // Index management
    createIndexes
};