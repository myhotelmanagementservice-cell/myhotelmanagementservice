// server/utils/foodItemHelpers.js
// Purpose: Native MongoDB operations for food menu management with multi-tenant support

const { ObjectId } = require('mongodb');

// ============================================
// CREATE INDEXES (Run once during setup)
// ============================================
async function createFoodItemIndexes(db) {
  const collection = db.collection('foodItems');

  await collection.createIndex({ hotelId: 1 }, { background: true });
  await collection.createIndex({ hotelId: 1, name: 1 }, { unique: true, background: true });
  await collection.createIndex({ hotelId: 1, category: 1 }, { background: true });
  await collection.createIndex({ hotelId: 1, available: 1 }, { background: true });
  await collection.createIndex({ hotelId: 1, price: -1 }, { background: true });

  console.log('✅ FoodItem indexes created');
}

// ============================================
// GET ALL FOOD ITEMS (Multi-Tenant + Filters)
// ============================================
async function getFoodItems(db, hotelId, options = {}) {
  const { category, available, search, minPrice, maxPrice, limit = 100, page = 1 } = options;

  let filter = { hotelId };

  if (category) filter.category = category;
  if (available !== undefined) filter.available = available === 'true';
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = parseFloat(maxPrice);
  }
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    db.collection('foodItems')
      .find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('foodItems').countDocuments(filter)
  ]);

  return { 
    items, 
    total, 
    page, 
    limit, 
    pages: Math.ceil(total / limit) 
  };
}

// ============================================
// GET SINGLE FOOD ITEM BY ID
// ============================================
async function getFoodItemById(db, hotelId, foodItemId) {
  if (!ObjectId.isValid(foodItemId)) {
    throw new Error('Invalid food item ID');
  }

  return await db.collection('foodItems').findOne({ 
    _id: new ObjectId(foodItemId), 
    hotelId 
  });
}

// ============================================
// GET FOOD ITEMS BY CATEGORY
// ============================================
async function getFoodItemsByCategory(db, hotelId, category, options = {}) {
  const { available = true, limit = 50, sortBy = 'name' } = options;

  const filter = { hotelId, category };
  if (available !== undefined) filter.available = available;

  const sortOptions = {
    name: { name: 1 },
    price: { price: 1 },
    popularity: { orderCount: -1 },
    newest: { createdAt: -1 }
  };

  return await db.collection('foodItems')
    .find(filter)
    .sort(sortOptions[sortBy] || sortOptions.name)
    .limit(limit)
    .toArray();
}

// ============================================
// CREATE NEW FOOD ITEM
// ============================================
async function createFoodItem(db, hotelId, foodData) {
  const { name, price, category, description, available, image, emoji, orderCount } = foodData;

  // Validate required fields
  if (!name || price === undefined) {
    throw new Error('name and price are required');
  }

  // Validate category enum
  const validCategories = ['Appetizer', 'Main Course', 'Dessert', 'Beverage', 'Snack'];
  if (category && !validCategories.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
  }

  // Check for duplicate name in same hotel
  const existing = await db.collection('foodItems').findOne({ 
    hotelId, 
    name: { $regex: new RegExp(`^${name}$`, 'i') } 
  });

  if (existing) {
    throw new Error('Food item with this name already exists');
  }

  const foodItem = {
    hotelId,
    name: name.trim(),
    price: parseFloat(price),
    basePriceSAR: parseFloat(price), // Store base SAR price for currency conversion
    category: category || 'Main Course',
    description: description?.trim() || '',
    available: available !== false,
    image: image || '',
    emoji: emoji || '🍽️',
    orderCount: orderCount || 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('foodItems').insertOne(foodItem);
  return { _id: result.insertedId, ...foodItem };
}

// ============================================
// UPDATE FOOD ITEM
// ============================================
async function updateFoodItem(db, hotelId, foodItemId, updates) {
  if (!ObjectId.isValid(foodItemId)) {
    throw new Error('Invalid food item ID');
  }

  // Fetch current item for duplicate check if name is changing
  const currentItem = await db.collection('foodItems').findOne({ 
    _id: new ObjectId(foodItemId), 
    hotelId 
  });

  if (!currentItem) {
    throw new Error('Food item not found');
  }

  // Validate category if being updated
  const validCategories = ['Appetizer', 'Main Course', 'Dessert', 'Beverage', 'Snack'];
  if (updates.category && !validCategories.includes(updates.category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
  }

  // Check for duplicate name if name is being updated
  if (updates.name && updates.name !== currentItem.name) {
    const existing = await db.collection('foodItems').findOne({ 
      hotelId, 
      name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
      _id: { $ne: new ObjectId(foodItemId) }
    });

    if (existing) {
      throw new Error('Food item with this name already exists');
    }
  }

  // Build update object
  const updateData = {
    updatedAt: new Date(),
    ...(updates.name && { name: updates.name.trim() }),
    ...(updates.price !== undefined && { 
      price: parseFloat(updates.price),
      basePriceSAR: parseFloat(updates.price)
    }),
    ...(updates.category && { category: updates.category }),
    ...(updates.description !== undefined && { description: updates.description.trim() }),
    ...(updates.available !== undefined && { available: updates.available }),
    ...(updates.image !== undefined && { image: updates.image }),
    ...(updates.emoji !== undefined && { emoji: updates.emoji }),
    ...(updates.orderCount !== undefined && { orderCount: parseInt(updates.orderCount) })
  };

  const result = await db.collection('foodItems').updateOne(
    { _id: new ObjectId(foodItemId), hotelId },
    { $set: updateData }
  );

  if (result.matchedCount === 0) {
    throw new Error('Food item not found');
  }

  return await db.collection('foodItems').findOne({ _id: new ObjectId(foodItemId) });
}

// ============================================
// DELETE FOOD ITEM (Soft Delete)
// ============================================
async function deleteFoodItem(db, hotelId, foodItemId) {
  if (!ObjectId.isValid(foodItemId)) {
    throw new Error('Invalid food item ID');
  }

  // Fetch item first for logging
  const food = await db.collection('foodItems').findOne({ 
    _id: new ObjectId(foodItemId), 
    hotelId 
  });

  if (!food) {
    throw new Error('Food item not found');
  }

  // Soft delete: mark as unavailable instead of hard delete
  const result = await db.collection('foodItems').updateOne(
    { _id: new ObjectId(foodItemId), hotelId },
    { 
      $set: { 
        available: false, 
        deletedAt: new Date(), 
        deletedBy: 'system',
        updatedAt: new Date() 
      } 
    }
  );

  return result.modifiedCount > 0;
}

// ============================================
// TOGGLE AVAILABILITY
// ============================================
async function toggleFoodItemAvailability(db, hotelId, foodItemId) {
  if (!ObjectId.isValid(foodItemId)) {
    throw new Error('Invalid food item ID');
  }

  const food = await db.collection('foodItems').findOne({ 
    _id: new ObjectId(foodItemId), 
    hotelId 
  });

  if (!food) {
    throw new Error('Food item not found');
  }

  const newAvailability = !food.available;

  await db.collection('foodItems').updateOne(
    { _id: new ObjectId(foodItemId), hotelId },
    { 
      $set: { 
        available: newAvailability,
        updatedAt: new Date() 
      } 
    }
  );

  return { _id: food._id, name: food.name, available: newAvailability };
}

// ============================================
// INCREMENT ORDER COUNT (for popularity tracking)
// ============================================
async function incrementOrderCount(db, hotelId, foodItemId, count = 1) {
  if (!ObjectId.isValid(foodItemId)) {
    throw new Error('Invalid food item ID');
  }

  const result = await db.collection('foodItems').updateOne(
    { _id: new ObjectId(foodItemId), hotelId },
    { 
      $inc: { orderCount: count },
      $set: { updatedAt: new Date() }
    }
  );

  if (result.matchedCount === 0) {
    throw new Error('Food item not found');
  }

  return await db.collection('foodItems').findOne({ _id: new ObjectId(foodItemId) });
}

// ============================================
// GET FOOD STATS (For Dashboard)
// ============================================
async function getFoodStats(db, hotelId) {
  const stats = await db.collection('foodItems').aggregate([
    { $match: { hotelId } },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        avgPrice: { $avg: '$price' },
        availableCount: { 
          $sum: { $cond: [{ $eq: ['$available', true] }, 1, 0] } 
        },
        totalOrderCount: { $sum: '$orderCount' }
      }
    }
  ]).toArray();

  const total = await db.collection('foodItems').countDocuments({ hotelId });
  const available = await db.collection('foodItems').countDocuments({ hotelId, available: true });
  const popular = await db.collection('foodItems')
    .find({ hotelId, available: true })
    .sort({ orderCount: -1 })
    .limit(5)
    .toArray();

  return {
    total,
    available,
    byCategory: stats.reduce((acc, s) => {
      acc[s._id] = { 
        count: s.count, 
        avgPrice: s.avgPrice?.toFixed(2), 
        available: s.availableCount,
        totalOrders: s.totalOrderCount 
      };
      return acc;
    }, {}),
    popular
  };
}

// ============================================
// SEARCH FOOD ITEMS
// ============================================
async function searchFoodItems(db, hotelId, query, options = {}) {
  const { limit = 20, category, available = true } = options;

  const filter = { 
    hotelId,
    available,
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { category: { $regex: query, $options: 'i' } }
    ]
  };

  if (category) filter.category = category;

  return await db.collection('foodItems')
    .find(filter)
    .sort({ orderCount: -1, name: 1 })
    .limit(limit)
    .toArray();
}

// ============================================
// GET POPULAR FOOD ITEMS
// ============================================
async function getPopularFoodItems(db, hotelId, options = {}) {
  const { limit = 10, category, available = true } = options;

  const filter = { hotelId, available };
  if (category) filter.category = category;

  return await db.collection('foodItems')
    .find(filter)
    .sort({ orderCount: -1, name: 1 })
    .limit(limit)
    .toArray();
}

// ============================================
// EXPORT FOOD MENU (For Reports)
// ============================================
async function exportFoodItems(db, hotelId, options = {}) {
  const { category, available, format = 'json', sortBy = 'name' } = options;

  let filter = { hotelId };
  if (category) filter.category = category;
  if (available !== undefined) filter.available = available;

  const sortOptions = {
    name: { name: 1 },
    price: { price: 1 },
    popularity: { orderCount: -1 },
    newest: { createdAt: -1 }
  };

  const items = await db.collection('foodItems')
    .find(filter)
    .sort(sortOptions[sortBy] || sortOptions.name)
    .toArray();

  if (format === 'csv') {
    const headers = ['Name', 'Category', 'Price', 'Available', 'Description', 'Emoji', 'Orders'];
    const rows = items.map(i => [
      i.name,
      i.category,
      i.price,
      i.available ? 'Yes' : 'No',
      `"${(i.description || '').replace(/"/g, '""')}"`,
      i.emoji || '',
      i.orderCount || 0
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  return items;
}

// ============================================
// BULK UPDATE FOOD ITEMS
// ============================================
async function bulkUpdateFoodItems(db, hotelId, foodItemIds, updates) {
  if (!Array.isArray(foodItemIds) || foodItemIds.length === 0) {
    throw new Error('foodItemIds array is required');
  }

  const objectIds = foodItemIds
    .filter(id => ObjectId.isValid(id))
    .map(id => new ObjectId(id));

  if (objectIds.length === 0) {
    throw new Error('No valid food item IDs provided');
  }

  const updateData = {
    ...updates,
    updatedAt: new Date()
  };

  const result = await db.collection('foodItems').updateMany(
    { _id: { $in: objectIds }, hotelId },
    { $set: updateData }
  );

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount
  };
}

// ============================================
// EXPORT
// ============================================
module.exports = {
  createFoodItemIndexes,
  getFoodItems,
  getFoodItemById,
  getFoodItemsByCategory,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  toggleFoodItemAvailability,
  incrementOrderCount,
  getFoodStats,
  searchFoodItems,
  getPopularFoodItems,
  exportFoodItems,
  bulkUpdateFoodItems
};