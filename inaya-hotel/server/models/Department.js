// server/models/Department.js
// Department Management Model - Native MongoDB Compatible
// Features: Complete CRUD, Multi-language, Categories, Validation, Default Departments
// Compatible with index.html (19 admin pages + 9 guest pages)

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Default departments for new hotels
 */
const DEFAULT_DEPARTMENTS = [
    {
        key: 'housekeeping',
        emoji: '🧹',
        name: { en: 'Housekeeping', hi: 'हाउसकीपिंग', ar: 'خدمة الغرف' },
        isEnabled: true,
        categories: [
            { key: 'cleaning', emoji: '🧽', name: { en: 'Room Cleaning', hi: 'कमरा सफाई', ar: 'تنظيف الغرفة' } },
            { key: 'laundry', emoji: '👕', name: { en: 'Laundry', hi: 'लॉन्ड्री', ar: 'غسيل الملابس' } },
            { key: 'linen', emoji: '🛏️', name: { en: 'Linen Change', hi: 'चादर बदलना', ar: 'تغيير البياضات' } }
        ]
    },
    {
        key: 'maintenance',
        emoji: '🔧',
        name: { en: 'Maintenance', hi: 'रखरखाव', ar: 'الصيانة' },
        isEnabled: true,
        categories: [
            { key: 'electrical', emoji: '💡', name: { en: 'Electrical', hi: 'बिजली', ar: 'كهربائية' } },
            { key: 'plumbing', emoji: '🚿', name: { en: 'Plumbing', hi: 'प्लंबिंग', ar: 'السباكة' } },
            { key: 'ac', emoji: '❄️', name: { en: 'AC Repair', hi: 'एसी मरम्मत', ar: 'إصلاح التكييف' } }
        ]
    },
    {
        key: 'food-beverage',
        emoji: '🍽️',
        name: { en: 'Food & Beverage', hi: 'खाना और पेय', ar: 'الطعام والمشروبات' },
        isEnabled: true,
        categories: [
            { key: 'room-service', emoji: '🛎️', name: { en: 'Room Service', hi: 'रूम सर्विस', ar: 'خدمة الغرف' } },
            { key: 'restaurant', emoji: '🍴', name: { en: 'Restaurant', hi: 'रेस्तरां', ar: 'المطعم' } },
            { key: 'bar', emoji: '🍹', name: { en: 'Bar', hi: 'बार', ar: 'البار' } }
        ]
    },
    {
        key: 'front-desk',
        emoji: '🛎️',
        name: { en: 'Front Desk', hi: 'फ्रंट डेस्क', ar: 'مكتب الاستقبال' },
        isEnabled: true,
        categories: [
            { key: 'check-in', emoji: '✅', name: { en: 'Check-in', hi: 'चेक-इन', ar: 'تسجيل الوصول' } },
            { key: 'check-out', emoji: '🚪', name: { en: 'Check-out', hi: 'चेक-आउट', ar: 'تسجيل المغادرة' } },
            { key: 'concierge', emoji: '🎩', name: { en: 'Concierge', hi: 'कंसीयज', ar: 'خدمة الكونسيرج' } }
        ]
    },
    {
        key: 'security',
        emoji: '👮',
        name: { en: 'Security', hi: 'सुरक्षा', ar: 'الأمن' },
        isEnabled: true,
        categories: [
            { key: 'patrol', emoji: '🚶', name: { en: 'Patrol', hi: 'गश्त', ar: 'دورية' } },
            { key: 'emergency', emoji: '🚨', name: { en: 'Emergency', hi: 'आपातकाल', ar: 'طوارئ' } },
            { key: 'access', emoji: '🔑', name: { en: 'Access Control', hi: 'एक्सेस कंट्रोल', ar: 'التحكم في الوصول' } }
        ]
    }
];

/**
 * Supported languages
 */
const LANGUAGES = ['en', 'hi', 'ar'];

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate department key format
 * @param {string} key - Department key
 * @returns {boolean} - True if valid
 */
function isValidKey(key) {
    if (!key || typeof key !== 'string') return false;
    return /^[a-z0-9-]{2,50}$/.test(key);
}

/**
 * Normalize multi-language content
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
 * Validate department data
 * @param {Object} data - Department data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateDepartment(data) {
    const errors = [];

    if (!data.key || !isValidKey(data.key)) {
        errors.push('Invalid department key. Must be 2-50 lowercase letters, numbers, or hyphens');
    }

    const name = normalizeMultiLangContent(data.name);
    if (!name.en || name.en.trim() === '') {
        errors.push('English name is required');
    }

    // Validate categories if provided
    if (data.categories && Array.isArray(data.categories)) {
        data.categories.forEach((cat, index) => {
            if (!cat.key || !isValidKey(cat.key)) {
                errors.push(`Category ${index + 1}: Invalid key format`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate category data
 * @param {Object} category - Category data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateCategory(category) {
    const errors = [];

    if (!category.key || !isValidKey(category.key)) {
        errors.push('Invalid category key');
    }

    const name = normalizeMultiLangContent(category.name);
    if (!name.en || name.en.trim() === '') {
        errors.push('English name is required');
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
 * Get all departments for a hotel
 * @param {string} hotelId - Hotel ID
 * @param {boolean} enabledOnly - If true, return only enabled departments
 * @returns {Array} - Array of departments
 */
async function getDepartments(hotelId, enabledOnly = false) {
    try {
        if (!isConnected()) return [];

        const db = getDB();
        if (!db) return [];

        const filter = { hotelId };
        if (enabledOnly) filter.isEnabled = true;

        const departments = await db.collection('departments')
            .find(filter)
            .sort({ key: 1 })
            .toArray();

        // Convert ObjectIds to strings
        departments.forEach(dept => {
            if (dept._id) dept._id = dept._id.toString();
        });

        return departments;
    } catch (error) {
        console.error('❌ getDepartments error:', error.message);
        return [];
    }
}

/**
 * Get single department by key
 * @param {string} hotelId - Hotel ID
 * @param {string} key - Department key
 * @returns {Object|null} - Department or null
 */
async function getDepartment(hotelId, key) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const department = await db.collection('departments').findOne({ hotelId, key });

        if (department && department._id) {
            department._id = department._id.toString();
        }

        return department;
    } catch (error) {
        console.error('❌ getDepartment error:', error.message);
        return null;
    }
}

/**
 * Get department by ID
 * @param {string} hotelId - Hotel ID
 * @param {string} departmentId - Department ID
 * @returns {Object|null} - Department or null
 */
async function getDepartmentById(hotelId, departmentId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const filter = { hotelId };

        if (ObjectId.isValid(departmentId)) {
            filter._id = new ObjectId(departmentId);
        } else {
            filter._id = departmentId;
        }

        const department = await db.collection('departments').findOne(filter);

        if (department && department._id) {
            department._id = department._id.toString();
        }

        return department;
    } catch (error) {
        console.error('❌ getDepartmentById error:', error.message);
        return null;
    }
}

/**
 * Create new department
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Department data
 * @returns {Object} - Created department
 */
async function createDepartment(hotelId, data) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateDepartment(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if department with this key already exists
        const existing = await db.collection('departments').findOne({ 
            hotelId, 
            key: data.key 
        });

        if (existing) {
            throw new Error(`Department with key "${data.key}" already exists`);
        }

        // Normalize multi-language content
        const name = normalizeMultiLangContent(data.name);

        // Normalize categories
        const categories = [];
        if (data.categories && Array.isArray(data.categories)) {
            for (const cat of data.categories) {
                const catValidation = validateCategory(cat);
                if (!catValidation.valid) {
                    throw new Error(`Category validation failed: ${catValidation.errors.join(', ')}`);
                }

                categories.push({
                    key: cat.key,
                    emoji: cat.emoji || '📂',
                    name: normalizeMultiLangContent(cat.name)
                });
            }
        }

        const department = {
            hotelId,
            key: data.key,
            emoji: data.emoji || '🏢',
            name,
            isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
            categories,
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('departments').insertOne(department);
        department._id = result.insertedId.toString();

        console.log(`✅ Department created for hotel: ${hotelId} (Key: ${department.key})`);
        return department;
    } catch (error) {
        console.error('❌ createDepartment error:', error.message);
        throw error;
    }
}

/**
 * Update department
 * @param {string} hotelId - Hotel ID
 * @param {string} key - Department key
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated department
 */
async function updateDepartment(hotelId, key, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Build update object
        const updateData = { updatedAt: new Date() };

        // Update name if provided
        if (updates.name) {
            updateData.name = normalizeMultiLangContent(updates.name);
        }

        // Update emoji if provided
        if (updates.emoji !== undefined) {
            updateData.emoji = updates.emoji;
        }

        // Update isEnabled if provided
        if (updates.isEnabled !== undefined) {
            updateData.isEnabled = updates.isEnabled;
        }

        // Update categories if provided
        if (updates.categories !== undefined) {
            const categories = [];
            if (Array.isArray(updates.categories)) {
                for (const cat of updates.categories) {
                    const catValidation = validateCategory(cat);
                    if (!catValidation.valid) {
                        throw new Error(`Category validation failed: ${catValidation.errors.join(', ')}`);
                    }

                    categories.push({
                        key: cat.key,
                        emoji: cat.emoji || '📂',
                        name: normalizeMultiLangContent(cat.name)
                    });
                }
            }
            updateData.categories = categories;
        }

        const result = await db.collection('departments').findOneAndUpdate(
            { hotelId, key },
            { 
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Department not found');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Department updated for hotel: ${hotelId} (Key: ${key})`);
        return result;
    } catch (error) {
        console.error('❌ updateDepartment error:', error.message);
        throw error;
    }
}

/**
 * Delete department
 * @param {string} hotelId - Hotel ID
 * @param {string} key - Department key
 * @returns {boolean} - Success status
 */
async function deleteDepartment(hotelId, key) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const result = await db.collection('departments').deleteOne({ hotelId, key });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Department not found for hotel: ${hotelId} (Key: ${key})`);
            return false;
        }

        console.log(`✅ Department deleted for hotel: ${hotelId} (Key: ${key})`);
        return true;
    } catch (error) {
        console.error('❌ deleteDepartment error:', error.message);
        throw error;
    }
}

/**
 * Delete all departments for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {number} - Number of deleted departments
 */
async function deleteAllDepartments(hotelId) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const result = await db.collection('departments').deleteMany({ hotelId });

        console.log(`✅ Deleted ${result.deletedCount} departments for hotel: ${hotelId}`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ deleteAllDepartments error:', error.message);
        return 0;
    }
}

/**
 * Toggle department enabled status
 * @param {string} hotelId - Hotel ID
 * @param {string} key - Department key
 * @returns {Object} - Updated department
 */
async function toggleDepartment(hotelId, key) {
    try {
        const department = await getDepartment(hotelId, key);
        if (!department) {
            throw new Error('Department not found');
        }

        return await updateDepartment(hotelId, key, {
            isEnabled: !department.isEnabled
        });
    } catch (error) {
        console.error('❌ toggleDepartment error:', error.message);
        throw error;
    }
}

// ============================================================
// CATEGORY MANAGEMENT
// ============================================================

/**
 * Add category to department
 * @param {string} hotelId - Hotel ID
 * @param {string} departmentKey - Department key
 * @param {Object} category - Category data
 * @returns {Object} - Updated department
 */
async function addCategory(hotelId, departmentKey, category) {
    try {
        const validation = validateCategory(category);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const department = await getDepartment(hotelId, departmentKey);
        if (!department) {
            throw new Error('Department not found');
        }

        // Check if category with this key already exists
        const existingCategory = department.categories.find(cat => cat.key === category.key);
        if (existingCategory) {
            throw new Error(`Category with key "${category.key}" already exists in this department`);
        }

        const newCategory = {
            key: category.key,
            emoji: category.emoji || '📂',
            name: normalizeMultiLangContent(category.name)
        };

        return await updateDepartment(hotelId, departmentKey, {
            categories: [...department.categories, newCategory]
        });
    } catch (error) {
        console.error('❌ addCategory error:', error.message);
        throw error;
    }
}

/**
 * Update category in department
 * @param {string} hotelId - Hotel ID
 * @param {string} departmentKey - Department key
 * @param {string} categoryKey - Category key
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated department
 */
async function updateCategory(hotelId, departmentKey, categoryKey, updates) {
    try {
        const department = await getDepartment(hotelId, departmentKey);
        if (!department) {
            throw new Error('Department not found');
        }

        const categoryIndex = department.categories.findIndex(cat => cat.key === categoryKey);
        if (categoryIndex === -1) {
            throw new Error(`Category with key "${categoryKey}" not found`);
        }

        const updatedCategories = [...department.categories];
        const category = updatedCategories[categoryIndex];

        if (updates.name) {
            category.name = normalizeMultiLangContent(updates.name);
        }
        if (updates.emoji !== undefined) {
            category.emoji = updates.emoji;
        }
        if (updates.key && updates.key !== categoryKey) {
            // Check if new key already exists
            const existingCategory = department.categories.find(cat => cat.key === updates.key);
            if (existingCategory) {
                throw new Error(`Category with key "${updates.key}" already exists`);
            }
            category.key = updates.key;
        }

        return await updateDepartment(hotelId, departmentKey, {
            categories: updatedCategories
        });
    } catch (error) {
        console.error('❌ updateCategory error:', error.message);
        throw error;
    }
}

/**
 * Remove category from department
 * @param {string} hotelId - Hotel ID
 * @param {string} departmentKey - Department key
 * @param {string} categoryKey - Category key
 * @returns {Object} - Updated department
 */
async function removeCategory(hotelId, departmentKey, categoryKey) {
    try {
        const department = await getDepartment(hotelId, departmentKey);
        if (!department) {
            throw new Error('Department not found');
        }

        const updatedCategories = department.categories.filter(cat => cat.key !== categoryKey);

        if (updatedCategories.length === department.categories.length) {
            throw new Error(`Category with key "${categoryKey}" not found`);
        }

        return await updateDepartment(hotelId, departmentKey, {
            categories: updatedCategories
        });
    } catch (error) {
        console.error('❌ removeCategory error:', error.message);
        throw error;
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Initialize default departments for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Created departments
 */
async function initializeDefaultDepartments(hotelId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        const createdDepartments = [];

        for (const deptData of DEFAULT_DEPARTMENTS) {
            // Check if already exists
            const existing = await db.collection('departments').findOne({ 
                hotelId, 
                key: deptData.key 
            });

            if (!existing) {
                const department = await createDepartment(hotelId, deptData);
                createdDepartments.push(department);
            }
        }

        console.log(`✅ Initialized ${createdDepartments.length} default departments for hotel: ${hotelId}`);
        return createdDepartments;
    } catch (error) {
        console.error('❌ initializeDefaultDepartments error:', error.message);
        throw error;
    }
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for departments collection
 * Call this on server startup
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound unique index: hotelId + key
        await db.collection('departments').createIndex(
            { hotelId: 1, key: 1 },
            { unique: true, background: true, name: 'hotelId_key_unique' }
        );

        // Index for enabled departments
        await db.collection('departments').createIndex(
            { hotelId: 1, isEnabled: 1 },
            { background: true, name: 'hotelId_isEnabled_idx' }
        );

        console.log('✅ Department indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    DEFAULT_DEPARTMENTS,
    LANGUAGES,

    // CRUD operations
    getDepartments,
    getDepartment,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    deleteAllDepartments,
    toggleDepartment,

    // Category management
    addCategory,
    updateCategory,
    removeCategory,

    // Initialization
    initializeDefaultDepartments,

    // Helpers
    isValidKey,
    normalizeMultiLangContent,
    getLocalizedContent,
    validateDepartment,
    validateCategory,

    // Index management
    createIndexes
};