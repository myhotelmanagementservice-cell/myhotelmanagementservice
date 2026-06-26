// server/utils/foodHelpers.js
// Purpose: Native MongoDB operations for food menu management
// Features: Multi-language, Bulk operations, Validation, Real-time Sync Ready
// Compatible with index.html (19 admin pages + 9 guest pages)

const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Default food categories
 */
const DEFAULT_CATEGORIES = [
    'Main Course',
    'Appetizer',
    'Dessert',
    'Beverages',
    'Breakfast',
    'Lunch',
    'Dinner',
    'Snacks',
    'Special'
];

/**
 * Supported languages for food items
 */
const LANGUAGES = ['en', 'hi', 'ar'];

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate food item data
 * @param {Object} data - Food item data
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateFoodItem(data) {
    const errors = [];

    // Check name (supports both string and multi-language object)
    if (!data.name) {
        errors.push('Name is required');
    } else if (typeof data.name === 'object') {
        if (!data.name.en || data.name.en.trim() === '') {
            errors.push('English name is required');
        }
    } else if (typeof data.name === 'string' && data.name.trim() === '') {
        errors.push('Name cannot be empty');
    }

    // Check price
    if (data.price === undefined || data.price === null) {
        errors.push('Price is required');
    } else if (isNaN(parseFloat(data.price)) || parseFloat(data.price) < 0) {
        errors.push('Price must be a non-negative number');
    }

    // Check category
    if (data.category && typeof data.category !== 'string') {
        errors.push('Category must be a string');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Normalize multi-language content
 * @param {Object|string} content - Content in multiple languages or single string
 * @returns {Object} - Normalized { en, hi, ar } object
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

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for food collection
 * @param {Object} db - MongoDB database instance
 */
async function createFoodIndexes(db) {
    try {
        const collection = db.collection('food');

        await collection.createIndex({ hotelId: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, name: 1 }, { unique: true, background: true });
        await collection.createIndex({ hotelId: 1, category: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, available: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, createdAt: -1 }, { background: true });

        console.log('✅ Food indexes created');
    } catch (error) {
        console.error('❌ createFoodIndexes error:', error.message);
    }
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Get all food items with filters and pagination
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} options - Filter options
 * @returns {Object} - { items, total, page, limit, pages }
 */
async function getFoodItems(db, hotelId, options = {}) {
    try {
        const { category, available, search, limit = 100, page = 1 } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };

        if (category) filter.category = category;
        if (available !== undefined) filter.available = available === 'true' || available === true;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { 'name.en': searchRegex },
                { 'name.hi': searchRegex },
                { 'name.ar': searchRegex },
                { description: searchRegex },
                { category: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
            db.collection('food')
                .find(filter)
                .sort({ category: 1, name: 1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('food').countDocuments(filter)
        ]);

        // Convert ObjectIds to strings
        items.forEach(item => {
            if (item._id) item._id = item._id.toString();
        });

        return { 
            items, 
            total, 
            page, 
            limit, 
            pages: Math.ceil(total / limit) 
        };
    } catch (error) {
        console.error('❌ getFoodItems error:', error.message);
        return { items: [], total: 0, page: 1, limit: 100, pages: 0 };
    }
}

/**
 * Get single food item by ID
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} foodId - Food item ID
 * @returns {Object|null} - Food item or null
 */
async function getFoodItemById(db, hotelId, foodId) {
    try {
        if (!ObjectId.isValid(foodId)) {
            throw new Error('Invalid food item ID');
        }

        const item = await db.collection('food').findOne({ 
            _id: new ObjectId(foodId), 
            hotelId,
            isDeleted: { $ne: true }
        });

        if (item && item._id) {
            item._id = item._id.toString();
        }

        return item;
    } catch (error) {
        console.error('❌ getFoodItemById error:', error.message);
        return null;
    }
}

/**
 * Create new food item
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} foodData - Food item data
 * @returns {Object} - Created food item
 */
async function createFoodItem(db, hotelId, foodData) {
    try {
        // Validate data
        const validation = validateFoodItem(foodData);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize name (support both string and multi-language)
        const name = normalizeMultiLangContent(foodData.name);

        // Check for duplicate name in same hotel
        const existing = await db.collection('food').findOne({ 
            hotelId, 
            'name.en': name.en,
            isDeleted: { $ne: true }
        });

        if (existing) {
            throw new Error('Food item with this name already exists');
        }

        const food = {
            hotelId,
            name,
            price: parseFloat(foodData.price),
            category: foodData.category || 'Main Course',
            description: foodData.description?.trim() || '',
            available: foodData.available !== false,
            image: foodData.image || '',
            emoji: foodData.emoji || '🍽️',
            isVegetarian: foodData.isVegetarian || false,
            isSpicy: foodData.isSpicy || false,
            allergens: foodData.allergens || [],
            preparationTime: foodData.preparationTime || 0,
            _version: 1,
            isDeleted: false,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('food').insertOne(food);
        food._id = result.insertedId.toString();

        console.log(`✅ Food item created for hotel: ${hotelId} (ID: ${food._id})`);
        return food;
    } catch (error) {
        console.error('❌ createFoodItem error:', error.message);
        throw error;
    }
}

/**
 * Update food item
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} foodId - Food item ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Updated food item
 */
async function updateFoodItem(db, hotelId, foodId, updates) {
    try {
        if (!ObjectId.isValid(foodId)) {
            throw new Error('Invalid food item ID');
        }

        // Fetch current item
        const currentItem = await db.collection('food').findOne({ 
            _id: new ObjectId(foodId), 
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!currentItem) {
            throw new Error('Food item not found');
        }

        // Build update object
        const updateData = { updatedAt: new Date() };

        // Update name if provided (normalize multi-language)
        if (updates.name) {
            const newName = normalizeMultiLangContent(updates.name);

            // Check for duplicate name if name is changing
            if (newName.en !== currentItem.name.en) {
                const existing = await db.collection('food').findOne({ 
                    hotelId, 
                    'name.en': newName.en,
                    _id: { $ne: new ObjectId(foodId) },
                    isDeleted: { $ne: true }
                });

                if (existing) {
                    throw new Error('Food item with this name already exists');
                }
            }

            updateData.name = newName;
        }

        // Update other fields
        if (updates.price !== undefined) {
            updateData.price = parseFloat(updates.price);
        }
        if (updates.category) updateData.category = updates.category;
        if (updates.description !== undefined) updateData.description = updates.description.trim();
        if (updates.available !== undefined) updateData.available = updates.available;
        if (updates.image !== undefined) updateData.image = updates.image;
        if (updates.emoji !== undefined) updateData.emoji = updates.emoji;
        if (updates.isVegetarian !== undefined) updateData.isVegetarian = updates.isVegetarian;
        if (updates.isSpicy !== undefined) updateData.isSpicy = updates.isSpicy;
        if (updates.allergens !== undefined) updateData.allergens = updates.allergens;
        if (updates.preparationTime !== undefined) updateData.preparationTime = updates.preparationTime;

        const result = await db.collection('food').findOneAndUpdate(
            { _id: new ObjectId(foodId), hotelId },
            { 
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Failed to update food item');
        }

        if (result._id) result._id = result._id.toString();

        console.log(`✅ Food item updated (ID: ${foodId})`);
        return result;
    } catch (error) {
        console.error('❌ updateFoodItem error:', error.message);
        throw error;
    }
}

/**
 * Delete food item (soft delete)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} foodId - Food item ID
 * @returns {boolean} - Success status
 */
async function deleteFoodItem(db, hotelId, foodId) {
    try {
        if (!ObjectId.isValid(foodId)) {
            throw new Error('Invalid food item ID');
        }

        const result = await db.collection('food').findOneAndUpdate(
            { _id: new ObjectId(foodId), hotelId, isDeleted: { $ne: true } },
            { 
                $set: { 
                    isDeleted: true,
                    available: false,
                    deletedAt: new Date(),
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            console.warn(`⚠️ Food item not found (ID: ${foodId})`);
            return false;
        }

        console.log(`✅ Food item deleted (ID: ${foodId})`);
        return true;
    } catch (error) {
        console.error('❌ deleteFoodItem error:', error.message);
        throw error;
    }
}

/**
 * Permanently delete food item (hard delete)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} foodId - Food item ID
 * @returns {boolean} - Success status
 */
async function permanentlyDeleteFoodItem(db, hotelId, foodId) {
    try {
        if (!ObjectId.isValid(foodId)) {
            throw new Error('Invalid food item ID');
        }

        const result = await db.collection('food').deleteOne({
            _id: new ObjectId(foodId),
            hotelId
        });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ Food item not found (ID: ${foodId})`);
            return false;
        }

        console.log(`✅ Food item permanently deleted (ID: ${foodId})`);
        return true;
    } catch (error) {
        console.error('❌ permanentlyDeleteFoodItem error:', error.message);
        throw error;
    }
}

/**
 * Toggle food availability
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} foodId - Food item ID
 * @returns {Object} - Updated food item
 */
async function toggleFoodAvailability(db, hotelId, foodId) {
    try {
        if (!ObjectId.isValid(foodId)) {
            throw new Error('Invalid food item ID');
        }

        const food = await db.collection('food').findOne({ 
            _id: new ObjectId(foodId), 
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!food) {
            throw new Error('Food item not found');
        }

        const newAvailability = !food.available;

        const result = await db.collection('food').findOneAndUpdate(
            { _id: new ObjectId(foodId), hotelId },
            { 
                $set: { 
                    available: newAvailability,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (result._id) result._id = result._id.toString();

        return result;
    } catch (error) {
        console.error('❌ toggleFoodAvailability error:', error.message);
        throw error;
    }
}

// ============================================================
// BULK OPERATIONS
// ============================================================

/**
 * Bulk create food items
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} foodItems - Array of food item data
 * @returns {Object} - { created: number, failed: number, errors: string[] }
 */
async function bulkCreateFoodItems(db, hotelId, foodItems) {
    try {
        if (!Array.isArray(foodItems) || foodItems.length === 0) {
            throw new Error('foodItems must be a non-empty array');
        }

        let created = 0;
        let failed = 0;
        const errors = [];

        for (const itemData of foodItems) {
            try {
                await createFoodItem(db, hotelId, itemData);
                created++;
            } catch (error) {
                failed++;
                errors.push(`${itemData.name?.en || itemData.name || 'Unknown'}: ${error.message}`);
            }
        }

        console.log(`✅ Bulk create: ${created} created, ${failed} failed`);
        return { created, failed, errors };
    } catch (error) {
        console.error('❌ bulkCreateFoodItems error:', error.message);
        throw error;
    }
}

/**
 * Bulk update food items
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} updates - Array of { id, data } objects
 * @returns {Object} - { updated: number, failed: number, errors: string[] }
 */
async function bulkUpdateFoodItems(db, hotelId, updates) {
    try {
        if (!Array.isArray(updates) || updates.length === 0) {
            throw new Error('updates must be a non-empty array');
        }

        let updated = 0;
        let failed = 0;
        const errors = [];

        for (const { id, data } of updates) {
            try {
                await updateFoodItem(db, hotelId, id, data);
                updated++;
            } catch (error) {
                failed++;
                errors.push(`${id}: ${error.message}`);
            }
        }

        console.log(`✅ Bulk update: ${updated} updated, ${failed} failed`);
        return { updated, failed, errors };
    } catch (error) {
        console.error('❌ bulkUpdateFoodItems error:', error.message);
        throw error;
    }
}

/**
 * Bulk delete food items
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} foodIds - Array of food item IDs
 * @returns {Object} - { deleted: number, failed: number }
 */
async function bulkDeleteFoodItems(db, hotelId, foodIds) {
    try {
        if (!Array.isArray(foodIds) || foodIds.length === 0) {
            throw new Error('foodIds must be a non-empty array');
        }

        let deleted = 0;
        let failed = 0;

        for (const foodId of foodIds) {
            try {
                const success = await deleteFoodItem(db, hotelId, foodId);
                if (success) deleted++;
                else failed++;
            } catch (error) {
                failed++;
            }
        }

        console.log(`✅ Bulk delete: ${deleted} deleted, ${failed} failed`);
        return { deleted, failed };
    } catch (error) {
        console.error('❌ bulkDeleteFoodItems error:', error.message);
        throw error;
    }
}

/**
 * Bulk toggle availability
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Array} foodIds - Array of food item IDs
 * @param {boolean} available - Target availability
 * @returns {Object} - { updated: number, failed: number }
 */
async function bulkToggleAvailability(db, hotelId, foodIds, available) {
    try {
        if (!Array.isArray(foodIds) || foodIds.length === 0) {
            throw new Error('foodIds must be a non-empty array');
        }

        const validIds = foodIds
            .filter(id => ObjectId.isValid(id))
            .map(id => new ObjectId(id));

        const result = await db.collection('food').updateMany(
            { 
                _id: { $in: validIds }, 
                hotelId,
                isDeleted: { $ne: true }
            },
            { 
                $set: { 
                    available,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            }
        );

        console.log(`✅ Bulk toggle: ${result.modifiedCount} updated`);
        return { 
            updated: result.modifiedCount, 
            failed: foodIds.length - result.modifiedCount 
        };
    } catch (error) {
        console.error('❌ bulkToggleAvailability error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================

/**
 * Search food items
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} - Matching food items
 */
async function searchFoodItems(db, hotelId, query, options = {}) {
    try {
        const { limit = 20, category, availableOnly = true } = options;

        const searchRegex = { $regex: query, $options: 'i' };

        const filter = { 
            hotelId,
            isDeleted: { $ne: true },
            $or: [
                { 'name.en': searchRegex },
                { 'name.hi': searchRegex },
                { 'name.ar': searchRegex },
                { description: searchRegex },
                { category: searchRegex }
            ]
        };

        if (category) filter.category = category;
        if (availableOnly) filter.available = true;

        const items = await db.collection('food')
            .find(filter)
            .sort({ name: 1 })
            .limit(limit)
            .toArray();

        items.forEach(item => {
            if (item._id) item._id = item._id.toString();
        });

        return items;
    } catch (error) {
        console.error('❌ searchFoodItems error:', error.message);
        return [];
    }
}

/**
 * Get food by category
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {string} category - Category name
 * @param {Object} options - Filter options
 * @returns {Array} - Food items in category
 */
async function getFoodByCategory(db, hotelId, category, options = {}) {
    try {
        const { available = true, limit = 50 } = options;

        const filter = { hotelId, category, isDeleted: { $ne: true } };
        if (available !== undefined) filter.available = available;

        const items = await db.collection('food')
            .find(filter)
            .sort({ name: 1 })
            .limit(limit)
            .toArray();

        items.forEach(item => {
            if (item._id) item._id = item._id.toString();
        });

        return items;
    } catch (error) {
        console.error('❌ getFoodByCategory error:', error.message);
        return [];
    }
}

/**
 * Get all categories used by a hotel
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @returns {Array} - Array of category names
 */
async function getCategories(db, hotelId) {
    try {
        const categories = await db.collection('food')
            .distinct('category', { 
                hotelId, 
                isDeleted: { $ne: true } 
            });

        return categories.sort();
    } catch (error) {
        console.error('❌ getCategories error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS & ANALYTICS
// ============================================================

/**
 * Get food statistics for dashboard
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @returns {Object} - Statistics
 */
async function getFoodStats(db, hotelId) {
    try {
        const stats = await db.collection('food').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 },
                    avgPrice: { $avg: '$price' },
                    minPrice: { $min: '$price' },
                    maxPrice: { $max: '$price' },
                    availableCount: { 
                        $sum: { $cond: [{ $eq: ['$available', true] }, 1, 0] } 
                    },
                    vegetarianCount: {
                        $sum: { $cond: [{ $eq: ['$isVegetarian', true] }, 1, 0] }
                    }
                }
            }
        ]).toArray();

        const totals = await db.collection('food').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    available: { $sum: { $cond: [{ $eq: ['$available', true] }, 1, 0] } },
                    unavailable: { $sum: { $cond: [{ $eq: ['$available', false] }, 1, 0] } },
                    avgPrice: { $avg: '$price' },
                    vegetarian: { $sum: { $cond: [{ $eq: ['$isVegetarian', true] }, 1, 0] } }
                }
            }
        ]).toArray();

        const total = totals[0] || { total: 0, available: 0, unavailable: 0, avgPrice: 0, vegetarian: 0 };

        return {
            total: total.total,
            available: total.available,
            unavailable: total.unavailable,
            avgPrice: total.avgPrice ? total.avgPrice.toFixed(2) : 0,
            vegetarian: total.vegetarian,
            byCategory: stats.reduce((acc, s) => {
                acc[s._id] = { 
                    count: s.count, 
                    avgPrice: s.avgPrice ? s.avgPrice.toFixed(2) : 0,
                    minPrice: s.minPrice,
                    maxPrice: s.maxPrice,
                    available: s.availableCount,
                    vegetarian: s.vegetarianCount
                };
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('❌ getFoodStats error:', error.message);
        return {
            total: 0,
            available: 0,
            unavailable: 0,
            avgPrice: 0,
            vegetarian: 0,
            byCategory: {}
        };
    }
}

/**
 * Get food count
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} filters - Filter options
 * @returns {number} - Count
 */
async function getFoodCount(db, hotelId, filters = {}) {
    try {
        const query = { hotelId, isDeleted: { $ne: true } };

        if (filters.category) query.category = filters.category;
        if (filters.available !== undefined) query.available = filters.available;

        return await db.collection('food').countDocuments(query);
    } catch (error) {
        console.error('❌ getFoodCount error:', error.message);
        return 0;
    }
}

// ============================================================
// EXPORT
// ============================================================

/**
 * Export food menu (for reports)
 * @param {Object} db - MongoDB database instance
 * @param {string} hotelId - Hotel ID
 * @param {Object} options - Export options
 * @returns {string|Array} - Exported data
 */
async function exportFoodMenu(db, hotelId, options = {}) {
    try {
        const { category, available, format = 'json', language = 'en' } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };
        if (category) filter.category = category;
        if (available !== undefined) filter.available = available;

        const items = await db.collection('food')
            .find(filter)
            .sort({ category: 1, name: 1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Name', 'Category', 'Price', 'Available', 'Vegetarian', 'Description', 'Emoji'];
            const rows = items.map(i => {
                const name = getLocalizedContent(i.name, language);
                return [
                    `"${name.replace(/"/g, '""')}"`,
                    i.category,
                    i.price,
                    i.available ? 'Yes' : 'No',
                    i.isVegetarian ? 'Yes' : 'No',
                    `"${(i.description || '').replace(/"/g, '""')}"`,
                    i.emoji || ''
                ];
            });

            return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        }

        // JSON format - localize names
        return items.map(item => ({
            ...item,
            _id: item._id?.toString(),
            displayName: getLocalizedContent(item.name, language)
        }));
    } catch (error) {
        console.error('❌ exportFoodMenu error:', error.message);
        return format === 'csv' ? '' : [];
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    DEFAULT_CATEGORIES,
    LANGUAGES,

    // Index management
    createFoodIndexes,

    // CRUD operations
    getFoodItems,
    getFoodItemById,
    createFoodItem,
    updateFoodItem,
    deleteFoodItem,
    permanentlyDeleteFoodItem,
    toggleFoodAvailability,

    // Bulk operations
    bulkCreateFoodItems,
    bulkUpdateFoodItems,
    bulkDeleteFoodItems,
    bulkToggleAvailability,

    // Search & filter
    searchFoodItems,
    getFoodByCategory,
    getCategories,

    // Statistics
    getFoodStats,
    getFoodCount,

    // Export
    exportFoodMenu,

    // Helpers
    validateFoodItem,
    normalizeMultiLangContent,
    getLocalizedContent
};