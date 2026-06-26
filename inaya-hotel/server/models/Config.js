// server/models/Config.js
// Hotel Configuration Model - Simplified Version (No Exchange Rates)
// Native MongoDB Compatible - Multi-tenant Ready

const { getDB, isConnected } = require('../config/db');

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================
const DEFAULT_CONFIG = {
    name: 'Crown Plaza Hotel',
    currency: 'SAR',
    currencySymbol: '﷼',
    wifi: 'CrownPlaza@2024',
    wifiPassword: 'Welcome123',
    airportPrice: 115,
    localPrice: 60,
    language: 'en',
    phone: '+966 12 345 6789',
    email: 'info@crownplaza.com',
    address: '123 King Road, Riyadh, Saudi Arabia',
    checkInTime: '2:00 PM',
    checkOutTime: '12:00 PM',
    _version: 1
};

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get hotel configuration
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Hotel config or default
 */
async function getConfig(hotelId) {
    try {
        if (!isConnected()) {
            return { _id: null, hotelId, ...DEFAULT_CONFIG };
        }

        const db = getDB();
        if (!db) {
            return { _id: null, hotelId, ...DEFAULT_CONFIG };
        }

        const config = await db.collection('config').findOne({ hotelId });

        if (!config) {
            return { _id: null, hotelId, ...DEFAULT_CONFIG };
        }

        // Convert ObjectId to string
        if (config._id) config._id = config._id.toString();

        return config;
    } catch (error) {
        console.error('❌ getConfig error:', error.message);
        return { _id: null, hotelId, ...DEFAULT_CONFIG };
    }
}

/**
 * Save hotel configuration (create or update)
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Config data
 * @returns {Object} - Saved config
 */
async function saveConfig(hotelId, data) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Prepare config data with defaults
        const configData = {
            ...DEFAULT_CONFIG,
            ...data,
            hotelId,
            updatedAt: new Date()
        };

        // Remove _id if present (will be auto-generated)
        delete configData._id;

        // Check if config exists
        const existing = await db.collection('config').findOne({ hotelId });

        let result;
        if (existing) {
            // Update existing
            result = await db.collection('config').findOneAndUpdate(
                { hotelId },
                { 
                    $set: configData,
                    $inc: { _version: 1 }
                },
                { returnDocument: 'after' }
            );
            console.log(`✅ Config updated for hotel: ${hotelId}`);
        } else {
            // Create new
            configData.createdAt = new Date();
            configData._version = 1;
            result = await db.collection('config').insertOne(configData);
            configData._id = result.insertedId.toString();
            console.log(`✅ Config created for hotel: ${hotelId}`);
        }

        // Convert ObjectId to string
        if (result._id) result._id = result._id.toString();

        return result;
    } catch (error) {
        console.error('❌ saveConfig error:', error.message);
        throw error;
    }
}

/**
 * Update specific config fields
 * @param {string} hotelId - Hotel ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated config
 */
async function updateConfig(hotelId, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Remove _id and hotelId from updates
        delete updates._id;
        delete updates.hotelId;

        const result = await db.collection('config').findOneAndUpdate(
            { hotelId },
            { 
                $set: { ...updates, updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after', upsert: true }
        );

        if (!result) {
            throw new Error('Config not found and could not be created');
        }

        // Convert ObjectId to string
        if (result._id) result._id = result._id.toString();

        console.log(`✅ Config fields updated for hotel: ${hotelId}`);
        return result;
    } catch (error) {
        console.error('❌ updateConfig error:', error.message);
        throw error;
    }
}

/**
 * Delete hotel configuration
 * @param {string} hotelId - Hotel ID
 * @returns {boolean} - Success status
 */
async function deleteConfig(hotelId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const result = await db.collection('config').deleteOne({ hotelId });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Config not found for hotel: ${hotelId}`);
            return false;
        }

        console.log(`✅ Config deleted for hotel: ${hotelId}`);
        return true;
    } catch (error) {
        console.error('❌ deleteConfig error:', error.message);
        throw error;
    }
}

/**
 * Get all hotel configs (for admin dashboard)
 * @returns {Array} - Array of all configs
 */
async function getAllConfigs() {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const configs = await db.collection('config').find({}).toArray();

        // Convert ObjectIds to strings
        configs.forEach(config => {
            if (config._id) config._id = config._id.toString();
        });

        return configs;
    } catch (error) {
        console.error('❌ getAllConfigs error:', error.message);
        return [];
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get specific config value
 * @param {string} hotelId - Hotel ID
 * @param {string} key - Config key
 * @returns {*} - Config value or default
 */
async function getConfigValue(hotelId, key) {
    const config = await getConfig(hotelId);
    return config[key] !== undefined ? config[key] : DEFAULT_CONFIG[key];
}

/**
 * Update cab prices (airport/local)
 * @param {string} hotelId - Hotel ID
 * @param {number} airportPrice - Airport cab price
 * @param {number} localPrice - Local cab price
 * @returns {Object} - Updated config
 */
async function updateCabPrices(hotelId, airportPrice, localPrice) {
    return await updateConfig(hotelId, {
        airportPrice: parseFloat(airportPrice),
        localPrice: parseFloat(localPrice)
    });
}

/**
 * Update WiFi settings
 * @param {string} hotelId - Hotel ID
 * @param {string} wifi - WiFi SSID
 * @param {string} wifiPassword - WiFi password
 * @returns {Object} - Updated config
 */
async function updateWifiSettings(hotelId, wifi, wifiPassword) {
    return await updateConfig(hotelId, {
        wifi,
        wifiPassword
    });
}

/**
 * Update hotel contact info
 * @param {string} hotelId - Hotel ID
 * @param {Object} contactInfo - Contact information
 * @returns {Object} - Updated config
 */
async function updateContactInfo(hotelId, contactInfo) {
    return await updateConfig(hotelId, {
        phone: contactInfo.phone,
        email: contactInfo.email,
        address: contactInfo.address
    });
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for config collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Unique index on hotelId
        await db.collection('config').createIndex(
            { hotelId: 1 },
            { unique: true, background: true, name: 'hotelId_unique' }
        );

        console.log('✅ Config indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    DEFAULT_CONFIG,

    // CRUD operations
    getConfig,
    saveConfig,
    updateConfig,
    deleteConfig,
    getAllConfigs,

    // Helper functions
    getConfigValue,
    updateCabPrices,
    updateWifiSettings,
    updateContactInfo,

    // Index management
    createIndexes
};