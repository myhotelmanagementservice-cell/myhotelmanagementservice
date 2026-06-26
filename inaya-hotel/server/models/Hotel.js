// server/models/Hotel.js
// Hotel Model - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const CURRENCIES = ['USD', 'SAR', 'INR', 'AED', 'EUR', 'GBP'];
const LANGUAGES = ['en', 'hi', 'ar', 'fr'];
const SUBSCRIPTIONS = ['free', 'basic', 'pro', 'enterprise'];

const CURRENCY_SYMBOLS = {
    'USD': '$', 'SAR': '﷼', 'INR': '₹', 
    'AED': 'د.إ', 'EUR': '€', 'GBP': '£'
};

const DEFAULT_SETTINGS = {
    airportTransferPrice: 30,
    localCabPricePerHour: 15,
    maxStaff: 10
};

// ============================================================
// HELPER: Auto currency symbol
// ============================================================
function getCurrencySymbol(currency) {
    return CURRENCY_SYMBOLS[currency] || '$';
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

async function createHotel(data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!data.hotelId || !data.name || !data.country || !data.countryCode) {
            throw new Error('hotelId, name, country, and countryCode are required');
        }

        // Check duplicate
        const existing = await db.collection('hotels').findOne({ hotelId: data.hotelId });
        if (existing) throw new Error('Hotel ID already exists');

        const currency = CURRENCIES.includes(data.currency) ? data.currency : 'USD';

        const hotel = {
            hotelId: data.hotelId.trim(),
            name: data.name.trim(),
            country: data.country.trim(),
            countryCode: data.countryCode.trim().toUpperCase(),
            currency,
            currencySymbol: getCurrencySymbol(currency),
            timezone: data.timezone || 'UTC',
            language: LANGUAGES.includes(data.language) ? data.language : 'en',
            wifiPassword: data.wifiPassword || 'CrownPlaza@2024',
            logo: data.logo || '',
            theme: {
                primaryColor: data.theme?.primaryColor || '#667eea',
                secondaryColor: data.theme?.secondaryColor || '#764ba2'
            },
            isActive: data.isActive !== undefined ? data.isActive : true,
            subscription: SUBSCRIPTIONS.includes(data.subscription) ? data.subscription : 'free',
            settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('hotels').insertOne(hotel);
        hotel._id = result.insertedId.toString();
        return hotel;
    } catch (error) {
        console.error('❌ createHotel error:', error.message);
        throw error;
    }
}

async function getHotel(hotelId) {
    try {
        if (!isConnected()) return null;
        const db = getDB();
        if (!db) return null;

        const hotel = await db.collection('hotels').findOne({ hotelId });
        if (hotel && hotel._id) hotel._id = hotel._id.toString();
        return hotel;
    } catch (error) {
        console.error('❌ getHotel error:', error.message);
        return null;
    }
}

async function getHotelById(id) {
    try {
        if (!isConnected() || !ObjectId.isValid(id)) return null;
        const db = getDB();
        if (!db) return null;

        const hotel = await db.collection('hotels').findOne({ _id: new ObjectId(id) });
        if (hotel && hotel._id) hotel._id = hotel._id.toString();
        return hotel;
    } catch (error) {
        console.error('❌ getHotelById error:', error.message);
        return null;
    }
}

async function getAllHotels(filters = {}) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const query = {};
        if (filters.isActive !== undefined) query.isActive = filters.isActive;
        if (filters.country) query.country = filters.country;
        if (filters.subscription) query.subscription = filters.subscription;

        const hotels = await db.collection('hotels')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        hotels.forEach(h => { if (h._id) h._id = h._id.toString(); });
        return hotels;
    } catch (error) {
        console.error('❌ getAllHotels error:', error.message);
        return [];
    }
}

async function updateHotel(hotelId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        // Auto-update currency symbol if currency changes
        if (updates.currency) {
            updates.currencySymbol = getCurrencySymbol(updates.currency);
        }

        // Handle nested theme update
        if (updates.theme) {
            const current = await getHotel(hotelId);
            updates.theme = { ...current?.theme, ...updates.theme };
        }

        // Handle nested settings update
        if (updates.settings) {
            const current = await getHotel(hotelId);
            updates.settings = { ...DEFAULT_SETTINGS, ...current?.settings, ...updates.settings };
        }

        const updateData = { ...updates, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.hotelId; // Don't allow changing hotelId

        const result = await db.collection('hotels').findOneAndUpdate(
            { hotelId },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Hotel not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateHotel error:', error.message);
        throw error;
    }
}

async function deleteHotel(hotelId) {
    try {
        if (!isConnected()) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('hotels').deleteOne({ hotelId });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ deleteHotel error:', error.message);
        return false;
    }
}

async function toggleHotelStatus(hotelId) {
    try {
        const hotel = await getHotel(hotelId);
        if (!hotel) throw new Error('Hotel not found');

        return await updateHotel(hotelId, { isActive: !hotel.isActive });
    } catch (error) {
        console.error('❌ toggleHotelStatus error:', error.message);
        throw error;
    }
}

async function updateSettings(hotelId, settings) {
    try {
        const hotel = await getHotel(hotelId);
        if (!hotel) throw new Error('Hotel not found');

        return await updateHotel(hotelId, {
            settings: { ...hotel.settings, ...settings }
        });
    } catch (error) {
        console.error('❌ updateSettings error:', error.message);
        throw error;
    }
}

async function getHotelCount(filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = {};
        if (filters.isActive !== undefined) query.isActive = filters.isActive;
        if (filters.subscription) query.subscription = filters.subscription;

        return await db.collection('hotels').countDocuments(query);
    } catch (error) {
        console.error('❌ getHotelCount error:', error.message);
        return 0;
    }
}

async function createIndexes() {
    try {
        if (!isConnected()) return;
        const db = getDB();
        if (!db) return;

        await db.collection('hotels').createIndex(
            { hotelId: 1 },
            { unique: true, background: true, name: 'hotelId_unique' }
        );
        await db.collection('hotels').createIndex(
            { isActive: 1 },
            { background: true, name: 'isActive_idx' }
        );
        await db.collection('hotels').createIndex(
            { country: 1 },
            { background: true, name: 'country_idx' }
        );

        console.log('✅ Hotel indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    CURRENCIES,
    LANGUAGES,
    SUBSCRIPTIONS,
    CURRENCY_SYMBOLS,
    DEFAULT_SETTINGS,
    getCurrencySymbol,
    createHotel,
    getHotel,
    getHotelById,
    getAllHotels,
    updateHotel,
    deleteHotel,
    toggleHotelStatus,
    updateSettings,
    getHotelCount,
    createIndexes
};