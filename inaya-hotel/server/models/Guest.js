// server/utils/guestHelpers.js

const { ObjectId } = require('mongodb');

/**
 * Create indexes for the Guests collection to optimize queries.
 * Run this once during server startup.
 */
async function createGuestIndexes(db) {
  try {
    const collection = db.collection('guests');
    await collection.createIndex({ hotelId: 1 }, { background: true });
    // Unique email per hotel (sparse allows null/missing emails)
    await collection.createIndex({ hotelId: 1, email: 1 }, { unique: true, sparse: true, background: true }); 
    // Room lookup index
    await collection.createIndex({ hotelId: 1, room: 1 }, { background: true });
    // Text index for search functionality
    await collection.createIndex({ hotelId: 1, name: 'text' }, { background: true });
    console.log('✅ Guest indexes created');
  } catch (error) {
    console.error('⚠️ Guest index creation failed:', error.message);
  }
}

/**
 * Create a new guest record.
 */
async function createGuest(db, hotelId, guestData) {
  const { name, room, email, phone, points = 0, status = 'active' } = guestData;

  if (!name || !room) {
    throw new Error('Guest name and room number are required');
  }

  // Check for duplicate email if provided
  if (email) {
    const existing = await db.collection('guests').findOne({ hotelId, email });
    if (existing) throw new Error('A guest with this email already exists for this hotel');
  }

  const newGuest = {
    hotelId,
    name: name.trim(),
    room: String(room), // Ensure room is stored as string per schema
    email: email ? email.trim() : null,
    phone: phone ? phone.trim() : null,
    points: parseInt(points) || 0,
    status: status || 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('guests').insertOne(newGuest);
  return { _id: result.insertedId, ...newGuest };
}

/**
 * Fetch a single guest by ID.
 */
async function getGuestById(db, hotelId, guestId) {
  if (!ObjectId.isValid(guestId)) return null;
  return db.collection('guests').findOne({ _id: new ObjectId(guestId), hotelId });
}

/**
 * Fetch a list of guests with filtering and pagination.
 */
async function getGuests(db, hotelId, options = {}) {
  const { search, limit = 50, page = 1, status } = options;

  let filter = { hotelId };
  if (status) filter.status = status;

  // Search across name, email, or room
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { room: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [guests, total] = await Promise.all([
    db.collection('guests').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('guests').countDocuments(filter)
  ]);

  return { guests, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Update an existing guest record.
 */
async function updateGuest(db, hotelId, guestId, updates) {
  if (!ObjectId.isValid(guestId)) throw new Error('Invalid Guest ID');

  // Remove undefined values from update object
  const cleanUpdates = {};
  Object.keys(updates).forEach(key => {
    if (updates[key] !== undefined) cleanUpdates[key] = updates[key];
  });

  // Always update timestamp
  cleanUpdates.updatedAt = new Date();

  const result = await db.collection('guests').updateOne(
    { _id: new ObjectId(guestId), hotelId },
    { $set: cleanUpdates }
  );

  if (result.matchedCount === 0) throw new Error('Guest not found');

  return db.collection('guests').findOne({ _id: new ObjectId(guestId) });
}

/**
 * Permanently delete a guest record.
 */
async function deleteGuest(db, hotelId, guestId) {
  if (!ObjectId.isValid(guestId)) throw new Error('Invalid Guest ID');

  const result = await db.collection('guests').deleteOne({ _id: new ObjectId(guestId), hotelId });
  return result.deletedCount > 0;
}

/**
 * Add loyalty points to a guest (Atomic Operation).
 */
async function addPoints(db, hotelId, guestId, amount) {
  const result = await db.collection('guests').findOneAndUpdate(
    { _id: new ObjectId(guestId), hotelId },
    { $inc: { points: amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' } // Return the updated document
  );

  if (!result.value) throw new Error('Guest not found');
  return result.value;
}

/**
 * Redeem (subtract) loyalty points (Check balance first).
 */
async function redeemPoints(db, hotelId, guestId, amount) {
  // 1. Check current balance
  const guest = await db.collection('guests').findOne({ _id: new ObjectId(guestId), hotelId });
  if (!guest) throw new Error('Guest not found');
  if (guest.points < amount) throw new Error('Insufficient points balance');

  // 2. Perform deduction atomically
  const result = await db.collection('guests').findOneAndUpdate(
    { _id: new ObjectId(guestId), hotelId },
    { $inc: { points: -amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  return result.value;
}

/**
 * Find guest by email (useful for login or linking).
 */
async function getGuestByEmail(db, hotelId, email) {
  return db.collection('guests').findOne({ hotelId, email: email.trim() });
}

module.exports = {
  createGuestIndexes,
  createGuest,
  getGuestById,
  getGuests,
  updateGuest,
  deleteGuest,
  addPoints,
  redeemPoints,
  getGuestByEmail
};