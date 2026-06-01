const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

// Helper: Get DB instance from app
const getDB = (req) => req.app.get('db');
const getIO = (req) => req.app.get('io');

// Helper: Broadcast to hotel room via Socket.IO
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
  }).catch(() => {}); // Don't block response on log failure
};

// ============================================
// ROOMS ROUTES
// ============================================

// Get all rooms for current hotel
router.get('/rooms', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { status, type, search } = req.query;

    const filter = { hotelId: req.hotelId };
    if (status) filter.status = status;
    if (type) filter.type = type;
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
    console.error('GET /admin/rooms error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

// Create new room
router.post('/rooms', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { number, type, price, status, guestName, amenities } = req.body;

    // Validation
    if (!number || !type || !price) {
      return res.status(400).json({ success: false, error: 'number, type, and price are required' });
    }

    // Check duplicate room number
    const existing = await db.collection('rooms').findOne({ 
      hotelId: req.hotelId, 
      number: parseInt(number) 
    });
    if (existing) {
      return res.status(400).json({ success: false, error: `Room #${number} already exists` });
    }

    const room = {
      hotelId: req.hotelId,
      number: parseInt(number),
      type,
      price: parseFloat(price),
      status: status || 'Vacant',
      guestName: guestName || null,
      amenities: amenities || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;

    // Real-time broadcast
    broadcast(req, 'room_added', room);

    // Log action
    await logAction(req, 'room_created', `Room #${room.number} created`);

    res.status(201).json({ success: true, message: 'Room created', data: room });
  } catch (error) {
    console.error('POST /admin/rooms error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create room' });
  }
});

// Update room
router.put('/rooms/:id', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }

    // Check duplicate if changing number
    if (number && parseInt(number) !== undefined) {
      const existing = await db.collection('rooms').findOne({
        hotelId: req.hotelId,
        number: parseInt(number),
        _id: { $ne: new ObjectId(id) }
      });
      if (existing) {
        return res.status(400).json({ success: false, error: `Room #${number} already exists` });
      }
    }

    const updateData = {
      updatedAt: new Date(),
      ...(number && { number: parseInt(number) }),
      ...(type && { type }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(status && { status }),
      ...(guestName !== undefined && { guestName }),
      ...(amenities !== undefined && { amenities })
    };

    const result = await db.collection('rooms').updateOne(
      { _id: new ObjectId(id), hotelId: req.hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const updatedRoom = await db.collection('rooms').findOne({ _id: new ObjectId(id) });

    // Real-time broadcast
    broadcast(req, 'room_updated', updatedRoom);

    // Log action
    await logAction(req, 'room_updated', `Room #${updatedRoom?.number} updated`);

    res.json({ success: true, message: 'Room updated', data: updatedRoom });
  } catch (error) {
    console.error('PUT /admin/rooms/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update room' });
  }
});

// Delete room
router.delete('/rooms/:id', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid room ID' });
    }

    const room = await db.collection('rooms').findOne({ 
      _id: new ObjectId(id), 
      hotelId: req.hotelId 
    });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Prevent deleting occupied rooms
    if (room.status === 'Occupied') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot delete an occupied room. Check out the guest first.' 
      });
    }

    const result = await db.collection('rooms').deleteOne({ 
      _id: new ObjectId(id), 
      hotelId: req.hotelId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Real-time broadcast
    broadcast(req, 'room_deleted', { id, hotelId: req.hotelId, roomNumber: room.number });

    // Log action
    await logAction(req, 'room_deleted', `Room #${room.number} deleted`);

    res.json({ success: true, message: 'Room deleted', data: { id, roomNumber: room.number } });
  } catch (error) {
    console.error('DELETE /admin/rooms/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete room' });
  }
});

// ============================================
// FOOD MENU ROUTES
// ============================================

router.get('/food', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { category, available } = req.query;

    const filter = { hotelId: req.hotelId };
    if (category) filter.category = category;
    if (available !== undefined) filter.available = available === 'true';

    const food = await db.collection('food')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    res.json({ success: true, data: food, count: food.length });
  } catch (error) {
    console.error('GET /admin/food error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch food items' });
  }
});

router.post('/food', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { name, price, category, description, available, image } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'name and price are required' });
    }

    const food = {
      hotelId: req.hotelId,
      name,
      price: parseFloat(price),
      category: category || 'Main Course',
      description: description || '',
      available: available !== false,
      image: image || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('food').insertOne(food);
    food._id = result.insertedId;

    broadcast(req, 'food_added', food);
    await logAction(req, 'food_created', `Food item "${name}" created`);

    res.status(201).json({ success: true, message: 'Food item created', data: food });
  } catch (error) {
    console.error('POST /admin/food error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create food item' });
  }
});

router.put('/food/:id', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const { name, price, category, description, available, image } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid food ID' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(category && { category }),
      ...(description !== undefined && { description }),
      ...(available !== undefined && { available }),
      ...(image !== undefined && { image })
    };

    const result = await db.collection('food').updateOne(
      { _id: new ObjectId(id), hotelId: req.hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    const updatedFood = await db.collection('food').findOne({ _id: new ObjectId(id) });

    broadcast(req, 'food_updated', updatedFood);
    await logAction(req, 'food_updated', `Food item "${updatedFood?.name}" updated`);

    res.json({ success: true, message: 'Food item updated', data: updatedFood });
  } catch (error) {
    console.error('PUT /admin/food/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update food item' });
  }
});

router.delete('/food/:id', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid food ID' });
    }

    const food = await db.collection('food').findOne({ 
      _id: new ObjectId(id), 
      hotelId: req.hotelId 
    });

    if (!food) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    const result = await db.collection('food').deleteOne({ 
      _id: new ObjectId(id), 
      hotelId: req.hotelId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    broadcast(req, 'food_deleted', { id, hotelId: req.hotelId, name: food.name });
    await logAction(req, 'food_deleted', `Food item "${food.name}" deleted`);

    res.json({ success: true, message: 'Food item deleted', data: { id, name: food.name } });
  } catch (error) {
    console.error('DELETE /admin/food/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete food item' });
  }
});

// ============================================
// HOTEL SETTINGS ROUTES
// ============================================

router.get('/settings', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);

    const settings = await db.collection('settings').findOne({ hotelId: req.hotelId });

    if (!settings) {
      // Return default settings if none exist
      return res.json({ 
        success: true, 
        data: {
          hotelId: req.hotelId,
          hotelName: 'Hotel Name',
          currencySymbol: '$',
          priceFormat: 'symbol-first',
          taxRate: 0,
          wifiSSID: 'Hotel_Guest',
          wifiPassword: 'Welcome123',
          language: 'en',
          theme: { primaryColor: '#667eea' },
          transport: { airport: 30, local: 15 },
          updatedAt: new Date()
        } 
      });
    }

    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('GET /admin/settings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

router.put('/settings', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const settings = req.body;

    const updateData = {
      ...settings,
      hotelId: req.hotelId,
      updatedAt: new Date()
    };

    const result = await db.collection('settings').updateOne(
      { hotelId: req.hotelId },
      { $set: updateData },
      { upsert: true }
    );

    const updatedSettings = await db.collection('settings').findOne({ hotelId: req.hotelId });

    // Broadcast config update to all connected clients
    broadcast(req, 'cfg_upd', {
      hotelName: updatedSettings.hotelName,
      currencySymbol: updatedSettings.currencySymbol,
      wifiPassword: updatedSettings.wifiPassword,
      language: updatedSettings.language,
      theme: updatedSettings.theme
    });

    await logAction(req, 'settings_updated', 'Hotel settings updated');

    res.json({ success: true, message: 'Settings saved', data: updatedSettings });
  } catch (error) {
    console.error('PUT /admin/settings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

// ============================================
// DASHBOARD STATS ROUTE
// ============================================

router.get('/dashboard/stats', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const [rooms, bookings, requests, guests, food, inventory] = await Promise.all([
      db.collection('rooms').find({ hotelId }).toArray(),
      db.collection('bookings').find({ hotelId }).toArray(),
      db.collection('requests').find({ hotelId }).toArray(),
      db.collection('guests').find({ hotelId }).toArray(),
      db.collection('food').find({ hotelId }).toArray(),
      db.collection('inventory').find({ hotelId }).toArray()
    ]);

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
    const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const openRequests = requests.filter(r => r.status === 'open').length;
    const emergencyRequests = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;

    res.json({
      success: true,
      data: {
        rooms: { total: totalRooms, occupied: occupiedRooms, vacant: vacantRooms },
        bookings: { total: bookings.length, revenue: totalRevenue },
        requests: { total: requests.length, open: openRequests, emergency: emergencyRequests },
        guests: { total: guests.length, active: guests.filter(g => g.status === 'active').length },
        food: { total: food.length },
        inventory: { 
          total: inventory.length, 
          lowStock: inventory.filter(i => i.stock <= i.min).length,
          outOfStock: inventory.filter(i => i.stock <= 0).length
        },
        occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('GET /admin/dashboard/stats error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
