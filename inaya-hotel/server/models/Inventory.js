// server/utils/inventoryHelpers.js

const { ObjectId } = require('mongodb');

/**
 * Create indexes for the Inventory collection to optimize queries.
 * Run this once during server startup.
 */
async function createInventoryIndexes(db) {
  try {
    const collection = db.collection('inventory');

    // Multi-tenant isolation index
    await collection.createIndex({ hotelId: 1 }, { background: true });

    // Search by name (case-insensitive unique index for validation)
    await collection.createIndex({ hotelId: 1, name: 1 }, { unique: true, background: true });

    // Category filtering
    await collection.createIndex({ hotelId: 1, category: 1 }, { background: true });

    // Low stock queries
    await collection.createIndex({ hotelId: 1, stock: 1 }, { background: true });

    console.log('✅ Inventory indexes created');
  } catch (error) {
    console.error('⚠️ Inventory index creation failed:', error.message);
  }
}

/**
 * Fetch inventory items with optional filtering, pagination, and search.
 */
async function getInventory(db, hotelId, options = {}) {
  const { category, lowStock, search, limit = 50, page = 1 } = options;

  let filter = { hotelId };

  // Filter by category (if not 'All')
  if (category && category !== 'All') {
    filter.category = category;
  }

  // Filter for low stock items (stock <= min)
  if (lowStock === 'true') {
    filter.$expr = { $lte: ['$stock', '$min'] };
  }

  // Search by name or category
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  // Run query and count in parallel
  const [items, total] = await Promise.all([
    db.collection('inventory')
      .find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('inventory').countDocuments(filter)
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Get a single inventory item by ID.
 */
async function getInventoryItemById(db, hotelId, itemId) {
  if (!ObjectId.isValid(itemId)) throw new Error('Invalid Inventory Item ID');

  return db.collection('inventory').findOne({ 
    _id: new ObjectId(itemId), 
    hotelId 
  });
}

/**
 * Create a new inventory item.
 * Note: Mapped Mongoose 'item' -> 'name' and 'quantity' -> 'stock' to match frontend.
 */
async function createInventoryItem(db, hotelId, itemData) {
  const { name, category, stock, min, unit } = itemData;

  if (!name || stock === undefined) {
    throw new Error('Name and stock quantity are required');
  }

  // Check for duplicate name in this hotel
  const existing = await db.collection('inventory').findOne({ 
    hotelId, 
    name: { $regex: new RegExp(`^${name}$`, 'i') }
  });

  if (existing) throw new Error('Item with this name already exists');

  const newItem = {
    hotelId,
    name: name.trim(),
    category: category || 'General',
    stock: parseInt(stock),
    min: parseInt(min) || 10, // Default minimum threshold
    unit: unit || 'pcs',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('inventory').insertOne(newItem);
  return { _id: result.insertedId, ...newItem };
}

/**
 * Update an existing inventory item.
 */
async function updateInventoryItem(db, hotelId, itemId, updates) {
  if (!ObjectId.isValid(itemId)) throw new Error('Invalid Inventory Item ID');

  // Check for duplicate name if name is changing
  if (updates.name) {
    const existing = await db.collection('inventory').findOne({ 
      hotelId, 
      name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
      _id: { $ne: new ObjectId(itemId) }
    });
    if (existing) throw new Error('Item with this name already exists');
  }

  const updateData = {
    updatedAt: new Date(),
    ...(updates.name && { name: updates.name.trim() }),
    ...(updates.category && { category: updates.category }),
    ...(updates.stock !== undefined && { stock: parseInt(updates.stock) }),
    ...(updates.min !== undefined && { min: parseInt(updates.min) }),
    ...(updates.unit && { unit: updates.unit })
  };

  const result = await db.collection('inventory').updateOne(
    { _id: new ObjectId(itemId), hotelId },
    { $set: updateData }
  );

  if (result.matchedCount === 0) throw new Error('Inventory item not found');

  return db.collection('inventory').findOne({ _id: new ObjectId(itemId) });
}

/**
 * Adjust stock (increment or decrement).
 * Prevents stock from dropping below 0.
 */
async function adjustStock(db, hotelId, itemId, delta, reason = '') {
  if (!ObjectId.isValid(itemId)) throw new Error('Invalid Inventory Item ID');

  const deltaVal = parseInt(delta);
  if (isNaN(deltaVal)) throw new Error('Invalid stock adjustment value');

  // Find current item to calculate new stock safely
  const item = await db.collection('inventory').findOne({ _id: new ObjectId(itemId), hotelId });
  if (!item) throw new Error('Inventory item not found');

  // Ensure stock doesn't go below 0
  const newStock = Math.max(0, item.stock + deltaVal);

  const result = await db.collection('inventory').updateOne(
    { _id: new ObjectId(itemId), hotelId },
    { 
      $set: { 
        stock: newStock, 
        updatedAt: new Date(),
        lastAdjustment: { delta: deltaVal, reason, date: new Date() }
      } 
    }
  );

  if (result.matchedCount === 0) throw new Error('Inventory item not found');

  return { ...item, stock: newStock };
}

/**
 * Soft delete an inventory item (mark as archived) or hard delete.
 * Here we use hard delete for simplicity, but you can add status='archived' if needed.
 */
async function deleteInventoryItem(db, hotelId, itemId) {
  if (!ObjectId.isValid(itemId)) throw new Error('Invalid Inventory Item ID');

  const result = await db.collection('inventory').deleteOne({ 
    _id: new ObjectId(itemId), 
    hotelId 
  });

  return result.deletedCount > 0;
}

/**
 * Get inventory statistics for the dashboard.
 */
async function getInventoryStats(db, hotelId) {
  const stats = await db.collection('inventory').aggregate([
    { $match: { hotelId } },
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        lowStockItems: {
          $sum: { $cond: [{ $lte: ['$stock', '$min'] }, 1, 0] }
        }
      }
    }
  ]).toArray();

  return stats[0] || { totalItems: 0, totalStock: 0, lowStockItems: 0 };
}

/**
 * Export inventory data to CSV format.
 */
async function exportInventory(db, hotelId) {
  const items = await db.collection('inventory').find({ hotelId }).toArray();

  const headers = ['Name', 'Category', 'Stock', 'Min', 'Unit'];
  const rows = items.map(i => [i.name, i.category, i.stock, i.min, i.unit]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

module.exports = {
  createInventoryIndexes,
  getInventory,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem,
  getInventoryStats,
  exportInventory
};
