// server/utils/foodHelpers.js
// Purpose: Native MongoDB operations for food menu management

const { ObjectId } = require('mongodb');

// ============================================
// CREATE INDEXES (Run once during setup)
// ============================================
async function createFoodIndexes(db) {
  const collection = db.collection('food');

  await collection.createIndex({ hotelId: 1 }, { background: true });
  await collection.createIndex({ hotelId: 1, name: 1 }, { unique: true, background: true });
  await collection.createIndex({ hotelId: 1, category: 1 }, { background: true });
  await collection.createIndex({ hotelId: 1, available: 1 }, { background: true });

  console.log('✅ Food indexes created');
}

// ============================================
// GET ALL FOOD ITEMS (Multi-Tenant + Filters)
// ============================================
async function getFoodItems(db, hotelId, options = {}) {
  const { category, available, search, limit = 100, page = 1 } = options;

  let filter = { hotelId };

  if (category) filter.category = category;
  if (available !== undefined) filter.available = available === 'true';
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    db.collection('food')
      .find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('food').countDocuments(filter)
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ============================================
// GET SINGLE FOOD ITEM BY ID
// ============================================
async function getFoodItemById(db, hotelId, foodId) {
  if (!ObjectId.isValid(foodId)) {
    throw new Error('Invalid food item ID');
  }

  return await db.collection('food').findOne({ 
    _id: new ObjectId(foodId), 
    hotelId 
  });
}

// ============================================
// CREATE NEW FOOD ITEM
// ============================================
async function createFoodItem(db, hotelId, foodData) {
  const { name, price, category, description, available, image, emoji } = foodData;

  // Validate required fields
  if (!name || price === undefined) {
    throw new Error('name and price are required');
  }

  // Check for duplicate name in same hotel
  const existing = await db.collection('food').findOne({ 
    hotelId, 
    name: { $regex: new RegExp(`^${name}$`, 'i') } 
  });

  if (existing) {
    throw new Error('Food item with this name already exists');
  }

  const food = {
    hotelId,
    name: name.trim(),
    price: parseFloat(price),
    basePriceSAR: parseFloat(price), // Store base SAR price for currency conversion
    category: category || 'Main Course',
    description: description?.trim() || '',
    available: available !== false,
    image: image || '',
    emoji: emoji || '🍽️',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('food').insertOne(food);
  return { _id: result.insertedId, ...food };
}

// ============================================
// UPDATE FOOD ITEM
// ============================================
async function updateFoodItem(db, hotelId, foodId, updates) {
  if (!ObjectId.isValid(foodId)) {
    throw new Error('Invalid food item ID');
  }

  // Fetch current item for duplicate check if name is changing
  const currentItem = await db.collection('food').findOne({ 
    _id: new ObjectId(foodId), 
    hotelId 
  });

  if (!currentItem) {
    throw new Error('Food item not found');
  }

  // Check for duplicate name if name is being updated
  if (updates.name && updates.name !== currentItem.name) {
    const existing = await db.collection('food').findOne({ 
      hotelId, 
      name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
      _id: { $ne: new ObjectId(foodId) }
    });

    if (existing) {
      throw new Error('Food item with this name already exists');
    }
  }

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
    ...(updates.emoji !== undefined && { emoji: updates.emoji })
  };

  const result = await db.collection('food').updateOne(
    { _id: new ObjectId(foodId), hotelId },
    { $set: updateData }
  );

  if (result.matchedCount === 0) {
    throw new Error('Food item not found');
  }

  return await db.collection('food').findOne({ _id: new ObjectId(foodId) });
}

// ============================================
// DELETE FOOD ITEM (Soft Delete)
// ============================================
async function deleteFoodItem(db, hotelId, foodId) {
  if (!ObjectId.isValid(foodId)) {
    throw new Error('Invalid food item ID');
  }

  // Fetch item first for logging
  const food = await db.collection('food').findOne({ 
    _id: new ObjectId(foodId), 
    hotelId 
  });

  if (!food) {
    throw new Error('Food item not found');
  }

  // Soft delete: mark as unavailable instead of hard delete
  const result = await db.collection('food').updateOne(
    { _id: new ObjectId(foodId), hotelId },
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
async function toggleFoodAvailability(db, hotelId, foodId) {
  if (!ObjectId.isValid(foodId)) {
    throw new Error('Invalid food item ID');
  }

  const food = await db.collection('food').findOne({ 
    _id: new ObjectId(foodId), 
    hotelId 
  });

  if (!food) {
    throw new Error('Food item not found');
  }

  const newAvailability = !food.available;

  await db.collection('food').updateOne(
    { _id: new ObjectId(foodId), hotelId },
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
// GET FOOD STATS (For Dashboard)
// ============================================
async function getFoodStats(db, hotelId) {
  const stats = await db.collection('food').aggregate([
    { $match: { hotelId } },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        avgPrice: { $avg: '$price' },
        availableCount: { 
          $sum: { $cond: [{ $eq: ['$available', true] }, 1, 0] } 
        }
      }
    }
  ]).toArray();

  const total = await db.collection('food').countDocuments({ hotelId });
  const available = await db.collection('food').countDocuments({ hotelId, available: true });

  return {
    total,
    available,
    byCategory: stats.reduce((acc, s) => {
      acc[s._id] = { count: s.count, avgPrice: s.avgPrice?.toFixed(2), available: s.availableCount };
      return acc;
    }, {})
  };
}

// ============================================
// SEARCH FOOD ITEMS
// ============================================
async function searchFoodItems(db, hotelId, query, options = {}) {
  const { limit = 20, category } = options;

  const filter = { 
    hotelId,
    available: true,
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { category: { $regex: query, $options: 'i' } }
    ]
  };

  if (category) filter.category = category;

  return await db.collection('food')
    .find(filter)
    .sort({ name: 1 })
    .limit(limit)
    .toArray();
}

// ============================================
// GET FOOD BY CATEGORY
// ============================================
async function getFoodByCategory(db, hotelId, category, options = {}) {
  const { available = true, limit = 50 } = options;

  const filter = { hotelId, category };
  if (available !== undefined) filter.available = available;

  return await db.collection('food')
    .find(filter)
    .sort({ name: 1 })
    .limit(limit)
    .toArray();
}

// ============================================
// EXPORT FOOD MENU (For Reports)
// ============================================
async function exportFoodMenu(db, hotelId, options = {}) {
  const { category, available, format = 'json' } = options;

  let filter = { hotelId };
  if (category) filter.category = category;
  if (available !== undefined) filter.available = available;

  const items = await db.collection('food')
    .find(filter)
    .sort({ category: 1, name: 1 })
    .toArray();

  if (format === 'csv') {
    const headers = ['Name', 'Category', 'Price', 'Available', 'Description', 'Emoji'];
    const rows = items.map(i => [
      i.name,
      i.category,
      i.price,
      i.available ? 'Yes' : 'No',
      `"${(i.description || '').replace(/"/g, '""')}"`,
      i.emoji || ''
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  return items;
}

// ============================================
// EXPORT
// ============================================
module.exports = {
  createFoodIndexes,
  getFoodItems,
  getFoodItemById,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  toggleFoodAvailability,
  getFoodStats,
  searchFoodItems,
  getFoodByCategory,
  exportFoodMenu
};