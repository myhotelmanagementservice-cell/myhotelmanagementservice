// 📋 Blacklist Collection Schema Reference (Native MongoDB)
// Use this structure when inserting documents into the 'blacklist' collection

const blacklistDocument = {
  // Required fields
  hotelId: String,        // 🔒 Multi-tenant isolation (e.g., "royal-saudi")
  name: String,           // Guest name to block
  reason: String,         // Reason for blocking

  // Optional fields
  room: Number,           // Room number (if applicable)
  blockedBy: String,      // Admin email who blocked
  blockedAt: Date,        // Timestamp of blocking

  // Auto-generated
  _id: ObjectId,          // MongoDB auto-generated ID
  createdAt: Date,        // Document creation time
  updatedAt: Date         // Last update time
};

// ✅ Example: Insert a blacklist entry (native MongoDB)
async function addToBlacklist(db, hotelId, name, reason, room = null, blockedBy = 'system') {
  const entry = {
    hotelId,
    name: name.trim(),
    reason: reason.trim(),
    room: room ? parseInt(room) : null,
    blockedBy,
    blockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('blacklist').insertOne(entry);
  return { _id: result.insertedId, ...entry };
}

// ✅ Example: Find blacklisted guests for a hotel
async function getBlacklist(db, hotelId) {
  return await db.collection('blacklist')
    .find({ hotelId })
    .sort({ blockedAt: -1 })
    .toArray();
}

// ✅ Example: Remove from blacklist
async function removeFromBlacklist(db, hotelId, entryId) {
  const { ObjectId } = require('mongodb');
  return await db.collection('blacklist').deleteOne({
    _id: new ObjectId(entryId),
    hotelId
  });
}

// ✅ Example: Check if guest is blacklisted
async function isBlacklisted(db, hotelId, guestName) {
  return await db.collection('blacklist').findOne({
    hotelId,
    name: { $regex: new RegExp(`^${guestName}$`, 'i') }
  });
}