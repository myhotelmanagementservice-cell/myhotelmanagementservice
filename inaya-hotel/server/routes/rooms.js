const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// Helper: Get DB from app
const getDB = (req) => req.app.get('db');

// Helper: Validate room input
const validateRoom = (data) => {
  const errors = [];
  if (!data.number || isNaN(parseInt(data.number))) errors.push('Room number is required');
  if (!data.type || !['Standard', 'Deluxe', 'Suite', 'Presidential'].includes(data.type)) {
    errors.push('Valid room type is required');
  }
  if (!data.price || isNaN(parseFloat(data.price)) || parseFloat(data.price) <= 0) {
    errors.push('Valid price is required');
  }
  return errors;
};

// ============================================
// GET ALL ROOMS (with optional filters)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, type, minPrice, maxPrice, search } = req.query;

    // Build filter object
    const filter = { hotelId };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    if (search) {
      filter.$or = [
        { number: { $regex: search, $options: 'i' } },
        { guestName: { $regex: search, $options: 'i' } }
      ];
    }

    const rooms = await db.collection('rooms')
      .find(filter)
      .sort({ number: 1 })
      .toArray();

    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('GET /api/rooms error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

// ============================================
// GET SINGLE ROOM BY ID
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }

    const room = await db.collection('rooms').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    res.json({ success: true, data: room });
  } catch (error) {
    console.error('GET /api/rooms/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch room' });
  }
});

// ============================================
// GET AVAILABLE ROOMS (Vacant status)
// ============================================
router.get('/available/quick', async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { type } = req.query;

    const filter = { hotelId, status: 'Vacant' };
    if (type) filter.type = type;

    const rooms = await db.collection('rooms')
      .find(filter)
      .sort({ number: 1 })
      .limit(20)
      .toArray();

    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('GET /api/rooms/available/quick error:', error.message);
    res.json({ success: true, data: [] }); // Fallback for offline mode
  }
});

// ============================================
// CREATE NEW ROOM
// ============================================
router.post('/', async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { number, type, price, status, guestName, amenities, notes } = req.body;

    // Validate input
    const errors = validateRoom({ number, type, price });
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors.join(', ') });
    }

    // Check for duplicate room number
    const existing = await db.collection('rooms').findOne({ 
      hotelId, 
      number: parseInt(number) 
    });

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: `Room #${number} already exists` 
      });
    }

    const room = {
      hotelId,
      number: parseInt(number),
      type,
      price: parseFloat(price),
      status: status || 'Vacant',
      guestName: guestName || null,
      amenities: amenities || [],
      notes: notes || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;

    // Real-time broadcast to all clients in this hotel
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${hotelId}`).emit('room_added', room);
    }

    // Log the action
    db.collection('logs').insertOne({
      hotelId,
      user: req.user?.email || 'system',
      action: 'room_created',
      details: `Room #${room.number} created by ${req.user?.email || 'system'}`,
      timestamp: new Date()
    }).catch(() => {}); // Don't block response on log failure

    res.status(201).json({ 
      success: true, 
      message: 'Room created successfully', 
      data: room 
    });
  } catch (error) {
    console.error('POST /api/rooms error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create room' });
  }
});

// ============================================
// UPDATE ROOM
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { number, type, price, status, guestName, amenities, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }

    // Validate if changing number (check for duplicates)
    if (number && parseInt(number) !== undefined) {
      const existing = await db.collection('rooms').findOne({ 
        hotelId, 
        number: parseInt(number),
        _id: { $ne: new ObjectId(id) } // Exclude current room
      });
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          error: `Room #${number} already exists` 
        });
      }
    }

    // Build update object
    const updateData = { updatedAt: new Date() };
    if (number !== undefined) updateData.number = parseInt(number);
    if (type) updateData.type = type;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (status) updateData.status = status;
    if (guestName !== undefined) updateData.guestName = guestName;
    if (amenities !== undefined) updateData.amenities = amenities;
    if (notes !== undefined) updateData.notes = notes;

    const result = await db.collection('rooms').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Fetch updated room for response
    const updatedRoom = await db.collection('rooms').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    const io = req.app.get('io');
    if (io && updatedRoom) {
      io.to(`hotel_${hotelId}`).emit('room_updated', updatedRoom);
    }

    // Log the action
    db.collection('logs').insertOne({
      hotelId,
      user: req.user?.email || 'system',
      action: 'room_updated',
      details: `Room #${updatedRoom?.number} updated by ${req.user?.email || 'system'}`,
      timestamp: new Date()
    }).catch(() => {});

    res.json({ 
      success: true, 
      message: 'Room updated successfully', 
      data: updatedRoom 
    });
  } catch (error) {
    console.error('PUT /api/rooms/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update room' });
  }
});

// ============================================
// DELETE ROOM
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }

    // Fetch room first for logging/broadcast
    const room = await db.collection('rooms').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Prevent deletion if room is occupied
    if (room.status === 'Occupied') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot delete an occupied room. Check out the guest first.' 
      });
    }

    const result = await db.collection('rooms').deleteOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Real-time broadcast
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${hotelId}`).emit('room_deleted', { 
        id, 
        hotelId, 
        roomNumber: room.number 
      });
    }

    // Log the action
    db.collection('logs').insertOne({
      hotelId,
      user: req.user?.email || 'system',
      action: 'room_deleted',
      details: `Room #${room.number} deleted by ${req.user?.email || 'system'}`,
      timestamp: new Date()
    }).catch(() => {});

    res.json({ 
      success: true, 
      message: 'Room deleted successfully',
      data: { id, roomNumber: room.number }
    });
  } catch (error) {
    console.error('DELETE /api/rooms/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete room' });
  }
});

// ============================================
// BULK UPDATE ROOMS (e.g., change status for multiple)
// ============================================
router.post('/bulk-update', async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { ids, update } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Room IDs array is required' });
    }
    if (!update || typeof update !== 'object') {
      return res.status(400).json({ success: false, error: 'Update object is required' });
    }

    // Convert string IDs to ObjectId
    const objectIds = ids
      .filter(id => ObjectId.isValid(id))
      .map(id => new ObjectId(id));

    if (objectIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid room IDs provided' });
    }

    const updateData = { 
      ...update, 
      updatedAt: new Date() 
    };

    const result = await db.collection('rooms').updateMany(
      { _id: { $in: objectIds }, hotelId },
      { $set: updateData }
    );

    // Real-time broadcast for each updated room
    const io = req.app.get('io');
    if (io && result.modifiedCount > 0) {
      const updatedRooms = await db.collection('rooms')
        .find({ _id: { $in: objectIds }, hotelId })
        .toArray();

      updatedRooms.forEach(room => {
        io.to(`hotel_${hotelId}`).emit('room_updated', room);
      });
    }

    // Log the action
    db.collection('logs').insertOne({
      hotelId,
      user: req.user?.email || 'system',
      action: 'rooms_bulk_updated',
      details: `${result.modifiedCount} rooms updated by ${req.user?.email || 'system'}`,
      timestamp: new Date()
    }).catch(() => {});

    res.json({ 
      success: true, 
      message: `${result.modifiedCount} rooms updated`,
      data: { modifiedCount: result.modifiedCount }
    });
  } catch (error) {
    console.error('POST /api/rooms/bulk-update error:', error.message);
    res.status(500).json({ success: false, error: 'Bulk update failed' });
  }
});

// ============================================
// GET ROOM STATS (for dashboard)
// ============================================
router.get('/stats/summary', async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('rooms').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' }
        }
      }
    ]).toArray();

    // Format stats for frontend
    const summary = {
      total: 0,
      byStatus: {},
      avgPriceOverall: 0
    };

    let totalRevenue = 0;
    let totalCount = 0;

    stats.forEach(s => {
      summary.byStatus[s._id] = s.count;
      summary.total += s.count;
      if (s._id === 'Occupied') {
        totalRevenue += s.avgPrice * s.count;
      }
      totalCount += s.count;
    });

    summary.avgPriceOverall = totalCount > 0 
      ? (totalRevenue / summary.byStatus['Occupied'] || 0).toFixed(2) 
      : 0;

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('GET /api/rooms/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

module.exports = router;