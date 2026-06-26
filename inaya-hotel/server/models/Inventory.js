// server/utils/inventoryHelpers.js
// Inventory Management - Native MongoDB Compatible

const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_CATEGORIES = ['General', 'Food', 'Beverage', 'Cleaning', 'Maintenance', 'Amenities', 'Other'];

// ============================================================
// VALIDATION
// ============================================================
function validateInventoryItem(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.name || data.name.trim() === '') errors.push('Name is required');
        if (data.stock === undefined || data.stock === null) errors.push('Stock is required');
    }

    if (data.stock !== undefined && (isNaN(data.stock) || data.stock < 0)) {
        errors.push('Stock must be a non-negative number');
    }

    if (data.min !== undefined && (isNaN(data.min) || data.min < 0)) {
        errors.push('Min must be a non-negative number');
    }

    return { valid: errors.length === 0, errors };
}

// ============================================================
// INDEXES
// ============================================================
async function createInventoryIndexes(db) {
    try {
        const collection = db.collection('inventory');

        await collection.createIndex({ hotelId: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, name: 1 }, { unique: true, background: true });
        await collection.createIndex({ hotelId: 1, category: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, stock: 1 }, { background: true });
        await collection.createIndex({ hotelId: 1, isDeleted: 1 }, { background: true });

        console.log('✅ Inventory indexes created');
    } catch (error) {
        console.error('⚠️ Inventory index creation failed:', error.message);
    }
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function getInventory(db, hotelId, options = {}) {
    try {
        const { category, lowStock, search, limit = 50, page = 1 } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };

        if (category && category !== 'All') filter.category = category;
        if (lowStock === 'true') filter.$expr = { $lte: ['$stock', '$min'] };

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { name: searchRegex },
                { category: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
            db.collection('inventory')
                .find(filter)
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('inventory').countDocuments(filter)
        ]);

        items.forEach(item => { if (item._id) item._id = item._id.toString(); });

        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getInventory error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getInventoryItemById(db, hotelId, itemId) {
    try {
        if (!ObjectId.isValid(itemId)) return null;

        const item = await db.collection('inventory').findOne({
            _id: new ObjectId(itemId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (item && item._id) item._id = item._id.toString();
        return item;
    } catch (error) {
        console.error('❌ getInventoryItemById error:', error.message);
        return null;
    }
}

async function createInventoryItem(db, hotelId, itemData) {
    try {
        const validation = validateInventoryItem(itemData);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const existing = await db.collection('inventory').findOne({
            hotelId,
            name: { $regex: new RegExp(`^${itemData.name}$`, 'i') },
            isDeleted: { $ne: true }
        });

        if (existing) throw new Error('Item with this name already exists');

        const newItem = {
            hotelId,
            name: itemData.name.trim(),
            category: itemData.category || 'General',
            stock: parseInt(itemData.stock),
            min: parseInt(itemData.min) || 10,
            unit: itemData.unit || 'pcs',
            supplier: itemData.supplier || '',
            costPerUnit: parseFloat(itemData.costPerUnit) || 0,
            location: itemData.location || '',
            notes: itemData.notes || '',
            stockHistory: [],
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('inventory').insertOne(newItem);
        newItem._id = result.insertedId.toString();

        return newItem;
    } catch (error) {
        console.error('❌ createInventoryItem error:', error.message);
        throw error;
    }
}

async function updateInventoryItem(db, hotelId, itemId, updates) {
    try {
        if (!ObjectId.isValid(itemId)) throw new Error('Invalid Item ID');

        const currentItem = await db.collection('inventory').findOne({
            _id: new ObjectId(itemId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!currentItem) throw new Error('Inventory item not found');

        if (updates.name && updates.name !== currentItem.name) {
            const existing = await db.collection('inventory').findOne({
                hotelId,
                name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
                _id: { $ne: new ObjectId(itemId) },
                isDeleted: { $ne: true }
            });
            if (existing) throw new Error('Item with this name already exists');
        }

        const updateData = { updatedAt: new Date() };

        if (updates.name) updateData.name = updates.name.trim();
        if (updates.category) updateData.category = updates.category;
        if (updates.stock !== undefined) updateData.stock = parseInt(updates.stock);
        if (updates.min !== undefined) updateData.min = parseInt(updates.min);
        if (updates.unit) updateData.unit = updates.unit;
        if (updates.supplier !== undefined) updateData.supplier = updates.supplier;
        if (updates.costPerUnit !== undefined) updateData.costPerUnit = parseFloat(updates.costPerUnit);
        if (updates.location !== undefined) updateData.location = updates.location;
        if (updates.notes !== undefined) updateData.notes = updates.notes;

        const result = await db.collection('inventory').findOneAndUpdate(
            { _id: new ObjectId(itemId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Failed to update item');
        if (result._id) result._id = result._id.toString();

        return result;
    } catch (error) {
        console.error('❌ updateInventoryItem error:', error.message);
        throw error;
    }
}

async function adjustStock(db, hotelId, itemId, delta, reason = '', performedBy = 'system') {
    try {
        if (!ObjectId.isValid(itemId)) throw new Error('Invalid Item ID');

        const deltaVal = parseInt(delta);
        if (isNaN(deltaVal)) throw new Error('Invalid stock adjustment value');

        const item = await db.collection('inventory').findOne({
            _id: new ObjectId(itemId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!item) throw new Error('Inventory item not found');

        const newStock = Math.max(0, item.stock + deltaVal);
        const historyEntry = {
            delta: deltaVal,
            previousStock: item.stock,
            newStock,
            reason,
            performedBy,
            date: new Date()
        };

        const result = await db.collection('inventory').findOneAndUpdate(
            { _id: new ObjectId(itemId), hotelId },
            {
                $set: { stock: newStock, updatedAt: new Date() },
                $push: { stockHistory: { $each: [historyEntry], $slice: -50 } },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ adjustStock error:', error.message);
        throw error;
    }
}

async function deleteInventoryItem(db, hotelId, itemId) {
    try {
        if (!ObjectId.isValid(itemId)) return false;

        const result = await db.collection('inventory').findOneAndUpdate(
            { _id: new ObjectId(itemId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteInventoryItem error:', error.message);
        return false;
    }
}

async function permanentlyDeleteInventoryItem(db, hotelId, itemId) {
    try {
        if (!ObjectId.isValid(itemId)) return false;

        const result = await db.collection('inventory').deleteOne({
            _id: new ObjectId(itemId),
            hotelId
        });

        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ permanentlyDeleteInventoryItem error:', error.message);
        return false;
    }
}

// ============================================================
// BULK OPERATIONS
// ============================================================
async function bulkCreateInventoryItems(db, hotelId, itemsData) {
    try {
        if (!Array.isArray(itemsData) || itemsData.length === 0) {
            throw new Error('itemsData must be a non-empty array');
        }

        let created = 0, failed = 0;
        const errors = [];

        for (const itemData of itemsData) {
            try {
                await createInventoryItem(db, hotelId, itemData);
                created++;
            } catch (error) {
                failed++;
                errors.push(`${itemData.name || 'Unknown'}: ${error.message}`);
            }
        }

        return { created, failed, errors };
    } catch (error) {
        console.error('❌ bulkCreateInventoryItems error:', error.message);
        throw error;
    }
}

async function bulkAdjustStock(db, hotelId, adjustments) {
    try {
        if (!Array.isArray(adjustments) || adjustments.length === 0) {
            throw new Error('adjustments must be a non-empty array');
        }

        let adjusted = 0, failed = 0;
        const errors = [];

        for (const adj of adjustments) {
            try {
                await adjustStock(db, hotelId, adj.itemId, adj.delta, adj.reason || 'Bulk adjustment', adj.performedBy || 'system');
                adjusted++;
            } catch (error) {
                failed++;
                errors.push(`${adj.itemId}: ${error.message}`);
            }
        }

        return { adjusted, failed, errors };
    } catch (error) {
        console.error('❌ bulkAdjustStock error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getInventoryByCategory(db, hotelId, category) {
    try {
        const items = await db.collection('inventory')
            .find({ hotelId, category, isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        items.forEach(item => { if (item._id) item._id = item._id.toString(); });
        return items;
    } catch (error) {
        console.error('❌ getInventoryByCategory error:', error.message);
        return [];
    }
}

async function getLowStockItems(db, hotelId) {
    try {
        const items = await db.collection('inventory')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                $expr: { $lte: ['$stock', '$min'] }
            })
            .sort({ stock: 1 })
            .toArray();

        items.forEach(item => { if (item._id) item._id = item._id.toString(); });
        return items;
    } catch (error) {
        console.error('❌ getLowStockItems error:', error.message);
        return [];
    }
}

async function getCategories(db, hotelId) {
    try {
        const categories = await db.collection('inventory')
            .distinct('category', { hotelId, isDeleted: { $ne: true } });

        return categories.sort();
    } catch (error) {
        console.error('❌ getCategories error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getInventoryStats(db, hotelId) {
    try {
        const stats = await db.collection('inventory').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    totalItems: { $sum: 1 },
                    totalStock: { $sum: '$stock' },
                    totalValue: { $sum: { $multiply: ['$stock', '$costPerUnit'] } },
                    lowStockItems: {
                        $sum: { $cond: [{ $lte: ['$stock', '$min'] }, 1, 0] }
                    }
                }
            }
        ]).toArray();

        const byCategory = await db.collection('inventory').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 },
                    totalStock: { $sum: '$stock' }
                }
            }
        ]).toArray();

        const result = stats[0] || { totalItems: 0, totalStock: 0, totalValue: 0, lowStockItems: 0 };

        return {
            totalItems: result.totalItems,
            totalStock: result.totalStock,
            totalValue: result.totalValue.toFixed(2),
            lowStockItems: result.lowStockItems,
            byCategory: byCategory.reduce((acc, s) => {
                acc[s._id] = { count: s.count, totalStock: s.totalStock };
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('❌ getInventoryStats error:', error.message);
        return { totalItems: 0, totalStock: 0, totalValue: '0.00', lowStockItems: 0, byCategory: {} };
    }
}

async function getInventoryCount(db, hotelId, filters = {}) {
    try {
        const query = { hotelId, isDeleted: { $ne: true } };

        if (filters.category) query.category = filters.category;
        if (filters.lowStock) query.$expr = { $lte: ['$stock', '$min'] };

        return await db.collection('inventory').countDocuments(query);
    } catch (error) {
        console.error('❌ getInventoryCount error:', error.message);
        return 0;
    }
}

// ============================================================
// EXPORT
// ============================================================
async function exportInventory(db, hotelId, format = 'csv') {
    try {
        const items = await db.collection('inventory')
            .find({ hotelId, isDeleted: { $ne: true } })
            .sort({ category: 1, name: 1 })
            .toArray();

        if (format === 'csv') {
            const headers = ['Name', 'Category', 'Stock', 'Min', 'Unit', 'Cost/Unit', 'Supplier', 'Location'];
            const rows = items.map(i => [
                i.name,
                i.category,
                i.stock,
                i.min,
                i.unit,
                i.costPerUnit || 0,
                i.supplier || '',
                i.location || ''
            ]);

            return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        }

        return items.map(item => ({ ...item, _id: item._id?.toString() }));
    } catch (error) {
        console.error('❌ exportInventory error:', error.message);
        return format === 'csv' ? '' : [];
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    DEFAULT_CATEGORIES,
    createInventoryIndexes,
    getInventory,
    getInventoryItemById,
    createInventoryItem,
    updateInventoryItem,
    adjustStock,
    deleteInventoryItem,
    permanentlyDeleteInventoryItem,
    bulkCreateInventoryItems,
    bulkAdjustStock,
    getInventoryByCategory,
    getLowStockItems,
    getCategories,
    getInventoryStats,
    getInventoryCount,
    exportInventory,
    validateInventoryItem
};