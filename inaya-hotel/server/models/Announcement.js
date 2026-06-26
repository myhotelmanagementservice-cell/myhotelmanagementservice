// server/models/Announcement.js
// Announcement Model - Native MongoDB Compatible
// Features: Multi-language support, Category validation, CRUD operations
// Compatible with index.html (19 admin pages + 9 guest pages)

const { getDB, isConnected } = require('../config/db');

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Valid announcement categories
 */
const CATEGORIES = ['welcome', 'offer', 'promo', 'service', 'wifi', 'emergency'];

/**
 * Supported languages
 */
const LANGUAGES = ['en', 'hi', 'ar'];

/**
 * Default announcement structure
 */
const DEFAULT_ANNOUNCEMENT = {
    category: 'welcome',
    title: { en: '', hi: '', ar: '' },
    message: { en: '', hi: '', ar: '' },
    isActive: true,
    _version: 1
};

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate announcement category
 * @param {string} category - Category to validate
 * @returns {boolean} - True if valid
 */
function isValidCategory(category) {
    return CATEGORIES.includes(category);
}

/**
 * Validate multi-language content
 * @param {Object} content - { en: string, hi: string, ar: string }
 * @returns {Object} - Normalized content
 */
function normalizeMultiLangContent(content) {
    if (!content) return { en: '', hi: '', ar: '' };

    // If content is a string, treat it as English
    if (typeof content === 'string') {
        return { en: content, hi: '', ar: '' };
    }

    return {
        en: content.en || '',
        hi: content.hi || '',
        ar: content.ar || ''
    };
}

/**
 * Get content in requested language (with fallback to English)
 * @param {Object} multiLangContent - { en, hi, ar }
 * @param {string} lang - Requested language
 * @returns {string} - Content in requested language
 */
function getLocalizedContent(multiLangContent, lang = 'en') {
    if (!multiLangContent) return '';

    const content = multiLangContent[lang];
    if (content && content.trim() !== '') return content;

    // Fallback to English
    return multiLangContent.en || '';
}

/**
 * Validate announcement data
 * @param {Object} data - Announcement data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateAnnouncement(data) {
    const errors = [];

    if (!data.category || !isValidCategory(data.category)) {
        errors.push(`Invalid category. Must be one of: ${CATEGORIES.join(', ')}`);
    }

    const title = normalizeMultiLangContent(data.title);
    if (!title.en || title.en.trim() === '') {
        errors.push('English title is required');
    }

    const message = normalizeMultiLangContent(data.message);
    if (!message.en || message.en.trim() === '') {
        errors.push('English message is required');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all announcements for a hotel
 * @param {string} hotelId - Hotel ID
 * @param {boolean} activeOnly - If true, return only active announcements
 * @returns {Array} - Array of announcements
 */
async function getAnnouncements(hotelId, activeOnly = false) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const filter = { hotelId };
        if (activeOnly) filter.isActive = true;

        const announcements = await db.collection('announcements')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        // Convert ObjectIds to strings
        announcements.forEach(a => {
            if (a._id) a._id = a._id.toString();
        });

        return announcements;
    } catch (error) {
        console.error('❌ getAnnouncements error:', error.message);
        return [];
    }
}

/**
 * Get single announcement by ID
 * @param {string} hotelId - Hotel ID
 * @param {string} announcementId - Announcement ID
 * @returns {Object|null} - Announcement or null
 */
async function getAnnouncement(hotelId, announcementId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const { ObjectId } = require('mongodb');
        const filter = { hotelId };

        if (ObjectId.isValid(announcementId)) {
            filter._id = new ObjectId(announcementId);
        } else {
            filter._id = announcementId;
        }

        const announcement = await db.collection('announcements').findOne(filter);

        if (announcement && announcement._id) {
            announcement._id = announcement._id.toString();
        }

        return announcement;
    } catch (error) {
        console.error('❌ getAnnouncement error:', error.message);
        return null;
    }
}

/**
 * Create new announcement
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Announcement data
 * @returns {Object} - Created announcement
 */
async function createAnnouncement(hotelId, data) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateAnnouncement(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize multi-language content
        const title = normalizeMultiLangContent(data.title);
        const message = normalizeMultiLangContent(data.message);

        const announcement = {
            hotelId,
            category: data.category,
            title,
            message,
            isActive: data.isActive !== undefined ? data.isActive : true,
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('announcements').insertOne(announcement);
        announcement._id = result.insertedId.toString();

        console.log(`✅ Announcement created for hotel: ${hotelId} (ID: ${announcement._id})`);
        return announcement;
    } catch (error) {
        console.error('❌ createAnnouncement error:', error.message);
        throw error;
    }
}

/**
 * Update existing announcement
 * @param {string} hotelId - Hotel ID
 * @param {string} announcementId - Announcement ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated announcement
 */
async function updateAnnouncement(hotelId, announcementId, updates) {
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

        if (ObjectId.isValid(announcementId)) {
            filter._id = new ObjectId(announcementId);
        } else {
            filter._id = announcementId;
        }

        // Build update object
        const updateData = { updatedAt: new Date() };

        // Update category if provided
        if (updates.category) {
            if (!isValidCategory(updates.category)) {
                throw new Error(`Invalid category. Must be one of: ${CATEGORIES.join(', ')}`);
            }
            updateData.category = updates.category;
        }

        // Update multi-language content
        if (updates.title) {
            updateData.title = normalizeMultiLangContent(updates.title);
        }
        if (updates.message) {
            updateData.message = normalizeMultiLangContent(updates.message);
        }

        // Update isActive if provided
        if (updates.isActive !== undefined) {
            updateData.isActive = updates.isActive;
        }

        const result = await db.collection('announcements').findOneAndUpdate(
            filter,
            { 
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Announcement not found');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Announcement updated for hotel: ${hotelId} (ID: ${announcementId})`);
        return result;
    } catch (error) {
        console.error('❌ updateAnnouncement error:', error.message);
        throw error;
    }
}

/**
 * Delete announcement
 * @param {string} hotelId - Hotel ID
 * @param {string} announcementId - Announcement ID
 * @returns {boolean} - Success status
 */
async function deleteAnnouncement(hotelId, announcementId) {
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

        if (ObjectId.isValid(announcementId)) {
            filter._id = new ObjectId(announcementId);
        } else {
            filter._id = announcementId;
        }

        const result = await db.collection('announcements').deleteOne(filter);

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Announcement not found for hotel: ${hotelId} (ID: ${announcementId})`);
            return false;
        }

        console.log(`✅ Announcement deleted for hotel: ${hotelId} (ID: ${announcementId})`);
        return true;
    } catch (error) {
        console.error('❌ deleteAnnouncement error:', error.message);
        throw error;
    }
}

/**
 * Delete all announcements for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {number} - Number of deleted announcements
 */
async function deleteAllAnnouncements(hotelId) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const result = await db.collection('announcements').deleteMany({ hotelId });

        console.log(`✅ Deleted ${result.deletedCount} announcements for hotel: ${hotelId}`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ deleteAllAnnouncements error:', error.message);
        return 0;
    }
}

/**
 * Toggle announcement active status
 * @param {string} hotelId - Hotel ID
 * @param {string} announcementId - Announcement ID
 * @returns {Object} - Updated announcement
 */
async function toggleAnnouncement(hotelId, announcementId) {
    try {
        const announcement = await getAnnouncement(hotelId, announcementId);
        if (!announcement) {
            throw new Error('Announcement not found');
        }

        return await updateAnnouncement(hotelId, announcementId, {
            isActive: !announcement.isActive
        });
    } catch (error) {
        console.error('❌ toggleAnnouncement error:', error.message);
        throw error;
    }
}

/**
 * Get announcements by category
 * @param {string} hotelId - Hotel ID
 * @param {string} category - Category to filter
 * @returns {Array} - Array of announcements
 */
async function getAnnouncementsByCategory(hotelId, category) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        if (!isValidCategory(category)) {
            throw new Error(`Invalid category. Must be one of: ${CATEGORIES.join(', ')}`);
        }

        const announcements = await db.collection('announcements')
            .find({ hotelId, category })
            .sort({ createdAt: -1 })
            .toArray();

        announcements.forEach(a => {
            if (a._id) a._id = a._id.toString();
        });

        return announcements;
    } catch (error) {
        console.error('❌ getAnnouncementsByCategory error:', error.message);
        return [];
    }
}

/**
 * Get active emergency announcements (for guest dashboard)
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Array of emergency announcements
 */
async function getEmergencyAnnouncements(hotelId) {
    return await getAnnouncementsByCategory(hotelId, 'emergency')
        .then(announcements => announcements.filter(a => a.isActive));
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for announcements collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound index for hotel + category queries
        await db.collection('announcements').createIndex(
            { hotelId: 1, category: 1 },
            { background: true, name: 'hotelId_category_idx' }
        );

        // Index for active announcements
        await db.collection('announcements').createIndex(
            { hotelId: 1, isActive: 1 },
            { background: true, name: 'hotelId_isActive_idx' }
        );

        // Index for sorting by creation date
        await db.collection('announcements').createIndex(
            { createdAt: -1 },
            { background: true, name: 'createdAt_idx' }
        );

        console.log('✅ Announcement indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    CATEGORIES,
    LANGUAGES,
    DEFAULT_ANNOUNCEMENT,

    // CRUD operations
    getAnnouncements,
    getAnnouncement,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    deleteAllAnnouncements,
    toggleAnnouncement,

    // Specialized queries
    getAnnouncementsByCategory,
    getEmergencyAnnouncements,

    // Helpers
    isValidCategory,
    normalizeMultiLangContent,
    getLocalizedContent,
    validateAnnouncement,

    // Index management
    createIndexes
};