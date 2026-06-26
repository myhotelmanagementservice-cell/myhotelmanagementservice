// server/models/Info.js
// Hotel Info Model - Native MongoDB Compatible
// Compatible with multi-tenant architecture

const { getDB, isConnected } = require('../config/db');

// ============================================================
// DEFAULT INFO SCHEMA (for reference)
// ============================================================
const DEFAULT_INFO = {
    name: 'Crown Plaza Hotel',
    currency: 'SAR',
    currencySymbol: '﷼',
    language: 'en',
    wifi: '',
    wifiPassword: 'Welcome123',
    airportPrice: 115,
    localPrice: 60,
    phone: '+966 12 345 6789',
    email: 'info@crownplaza.com',
    address: '123 King Road, Riyadh, Saudi Arabia',
    checkIn: '2:00 PM',
    checkOut: '12:00 PM',
    amenities: ['WiFi', 'Parking', 'Pool', 'Gym', 'Restaurant'],
    about: 'Welcome to Crown Plaza Hotel. Experience luxury and comfort in the heart of the city.',
    _version: 1
};

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get hotel info by hotelId
 * @param {string} hotelId - Hotel ID
 * @returns {Object|null} - Hotel info or null
 */
async function getInfo(hotelId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const info = await db.collection('info').findOne({ hotelId });

        // If not found, return default
        if (!info) {
            return {
                _id: null,
                hotelId,
                ...DEFAULT_INFO,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }

        // Convert ObjectId to string
        if (info._id) info._id = info._id.toString();

        return info;
    } catch (error) {
        console.error('❌ getInfo error:', error.message);
        return null;
    }
}

/**
 * Create or update hotel info
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Info data to save
 * @returns {Object} - Saved info
 */
async function saveInfo(hotelId, data) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Prepare data with defaults
        const infoData = {
            ...DEFAULT_INFO,
            ...data,
            hotelId,
            updatedAt: new Date()
        };

        // Check if exists
        const existing = await db.collection('info').findOne({ hotelId });

        let result;
        if (existing) {
            // Update existing
            result = await db.collection('info').findOneAndUpdate(
                { hotelId },
                { 
                    $set: infoData,
                    $inc: { _version: 1 }
                },
                { returnDocument: 'after' }
            );
            console.log(`✅ Info updated for hotel: ${hotelId}`);
        } else {
            // Create new
            infoData.createdAt = new Date();
            infoData._version = 1;
            result = await db.collection('info').insertOne(infoData);
            infoData._id = result.insertedId.toString();
            console.log(`✅ Info created for hotel: ${hotelId}`);
        }

        // Convert ObjectId to string
        if (result._id) result._id = result._id.toString();

        return result;
    } catch (error) {
        console.error('❌ saveInfo error:', error.message);
        throw error;
    }
}

/**
 * Update specific fields of hotel info
 * @param {string} hotelId - Hotel ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated info
 */
async function updateInfo(hotelId, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Remove _id and hotelId from updates (can't change these)
        delete updates._id;
        delete updates.hotelId;

        const result = await db.collection('info').findOneAndUpdate(
            { hotelId },
            { 
                $set: { ...updates, updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after', upsert: true }
        );

        if (!result) {
            throw new Error('Info not found and could not be created');
        }

        // Convert ObjectId to string
        if (result._id) result._id = result._id.toString();

        console.log(`✅ Info fields updated for hotel: ${hotelId}`);
        return result;
    } catch (error) {
        console.error('❌ updateInfo error:', error.message);
        throw error;
    }
}

/**
 * Delete hotel info
 * @param {string} hotelId - Hotel ID
 * @returns {boolean} - Success status
 */
async function deleteInfo(hotelId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const result = await db.collection('info').deleteOne({ hotelId });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Info not found for hotel: ${hotelId}`);
            return false;
        }

        console.log(`✅ Info deleted for hotel: ${hotelId}`);
        return true;
    } catch (error) {
        console.error('❌ deleteInfo error:', error.message);
        throw error;
    }
}

/**
 * Get all hotels info (for admin dashboard)
 * @returns {Array} - Array of all hotel info
 */
async function getAllInfo() {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const infos = await db.collection('info').find({}).toArray();

        // Convert ObjectIds to strings
        infos.forEach(info => {
            if (info._id) info._id = info._id.toString();
        });

        return infos;
    } catch (error) {
        console.error('❌ getAllInfo error:', error.message);
        return [];
    }
}

/**
 * Create indexes for info collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Create compound index (hotelId unique per collection)
        await db.collection('info').createIndex(
            { hotelId: 1 },
            { unique: true, background: true, name: 'hotelId_unique' }
        );

        // Index for faster queries
        await db.collection('info').createIndex(
            { language: 1 },
            { background: true, name: 'language_idx' }
        );

        console.log('✅ Info indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // CRUD operations
    getInfo,
    saveInfo,
    updateInfo,
    deleteInfo,
    getAllInfo,

    // Utilities
    createIndexes,
    DEFAULT_INFO
};