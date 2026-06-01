const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { protect, authorize } = require('../middleware/auth');

// Helper: Get DB instance from app
const getDB = (req) => req.app.get('db');

// Helper: Get IO instance for broadcasting
const getIO = (req) => req.app.get('io');

// Helper: Broadcast to hotel room
const broadcast = (req, event, data) => {
  const io = getIO(req);
  const hotelId = req.hotelId;
  if (io && hotelId) {
    io.to(`hotel_${hotelId}`).emit(event, data);
  }
};

// Helper: Log admin action
const logAction = async (req, action, details) => {
  const db = getDB(req);
  if (!db) return;
  await db.collection('logs').insertOne({
    hotelId: req.hotelId,
    user: req.user?.email || 'system',
    action,
    details,
    ip: req.ip,
    timestamp: new Date()
  }).catch(() => {});
};

// ============================================
// GET ALL BLACKLISTED GUESTS (Multi-Tenant)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    // Multi-tenant: Only fetch entries for this hotel
    const entries = await db.collection('blacklist')
      .find({ hotelId })
      .sort({ blockedAt: -1 })
      .toArray();

    res.json({ success: true, data: entries, count: entries.length });
  } catch (error) {
    console.error('GET /api/blacklist error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch blacklist' });
  }
});

// ============================================
// ADD TO BLACKLIST (Multi-Tenant)
// ============================================
router.post('/', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { guestName, room, reason, notes, blockedBy } = req.body;

    // Validate required fields
    if (!guestName || !reason) {
      return res.status(400).json({ 
        success: false, 
        error: 'guestName and reason are required' 
      });
    }

    // Create blacklist entry with hotel isolation
    const entry = {
      hotelId, // 🔒 Critical: Scope to current hotel
      guestName: guestName.trim(),
      room: room ? parseInt(room) : null,
      reason: reason.trim(),
      notes: notes?.trim() || '',
      blockedBy: blockedBy || req.user?.email || 'system',
      blockedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('blacklist').insertOne(entry);
    entry._id = result.insertedId;

    // Real-time broadcast to all clients in this hotel
    broadcast(req, 'blacklist_added', entry);

    // Log the action
    await logAction(req, 'blacklist_add', `Guest "${guestName}" blocked: ${reason}`);

    res.status(201).json({ 
      success: true, 
      message: 'Guest added to blacklist', 
      data: entry 
    });

  } catch (error) {
    console.error('POST /api/blacklist error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to add to blacklist' });
  }
});

// ============================================
// REMOVE FROM BLACKLIST (Unblock Guest)
// ============================================
router.delete('/:id', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid blacklist ID' });
    }

    // Fetch entry first for logging + ensure it belongs to this hotel
    const entry = await db.collection('blacklist').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!entry) {
      return res.status(404).json({ success: false, error: 'Blacklist entry not found' });
    }

    // Delete the entry
    const result = await db.collection('blacklist').deleteOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }

    // Real-time broadcast
    broadcast(req, 'blacklist_removed', { 
      id, 
      hotelId, 
      guestName: entry.guestName 
    });

    // Log the action
    await logAction(req, 'blacklist_remove', `Guest "${entry.guestName}" unblocked`);

    res.json({ 
      success: true, 
      message: 'Guest removed from blacklist',
      data: { id, guestName: entry.guestName }
    });

  } catch (error) {
    console.error('DELETE /api/blacklist/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to remove from blacklist' });
  }
});

// ============================================
// SEARCH BLACKLIST (Optional Utility)
// ============================================
router.get('/search', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ success: false, error: 'Search query required' });
    }

    // Multi-tenant search with case-insensitive regex
    const entries = await db.collection('blacklist')
      .find({
        hotelId,
        $or: [
          { guestName: { $regex: query, $options: 'i' } },
          { reason: { $regex: query, $options: 'i' } },
          { room: { $eq: parseInt(query) || null } }
        ]
      })
      .sort({ blockedAt: -1 })
      .limit(50)
      .toArray();

    res.json({ success: true, data: entries, count: entries.length });
  } catch (error) {
    console.error('GET /api/blacklist/search error:', error.message);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

// ============================================
// GET BLACKLIST STATS (For Dashboard)
// ============================================
router.get('/stats', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('blacklist').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          byReason: {
            $push: { reason: '$reason', count: 1 }
          },
          recent: {
            $push: { 
              guestName: '$guestName', 
              blockedAt: '$blockedAt',
              room: '$room'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          total: 1,
          recent: { $slice: ['$recent', 5] }, // Last 5 entries
          byReason: 1
        }
      }
    ]).toArray();

    res.json({ 
      success: true, 
      data: stats[0] || { total: 0, recent: [], byReason: [] } 
    });
  } catch (error) {
    console.error('GET /api/blacklist/stats error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

module.exports = router;