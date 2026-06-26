// server/controllers/adminController.js
// Compatible with native MongoDB driver (not Mongoose)

const { getDB } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ============ ADMIN LOGIN CONTROLLER (FIXED) ============
exports.adminLogin = async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;

    // ✅ Validation
    if (!email || !password || !hotelId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and hotelId are required' 
      });
    }

    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    // ✅ STEP 1: Verify hotel exists and is active
    const tenant = await db.collection('tenants').findOne({ hotelId });
    if (!tenant) {
      console.log(`❌ Hotel not found: ${hotelId}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Hotel not found. Please check Hotel ID.' 
      });
    }

    if (tenant.active === false) {
      console.log(`❌ Hotel is inactive: ${hotelId}`);
      return res.status(403).json({ 
        success: false, 
        error: 'Hotel account is inactive. Please contact support.' 
      });
    }

    // ✅ STEP 2: STRICT hotelId match - no fallback
    const user = await db.collection('users').findOne({
      email: email,
      hotelId: hotelId  // ✅ STRICT MATCH ONLY
    });

    if (!user) {
      console.log(`❌ User not found for hotel ${hotelId}: ${email}`);

      // Helpful debug info
      const userAnyHotel = await db.collection('users').findOne({ email });
      if (userAnyHotel) {
        console.log(`⚠️ User exists but belongs to different hotel: ${userAnyHotel.hotelId}`);
        return res.status(403).json({ 
          success: false, 
          error: `This account belongs to hotel ${userAnyHotel.hotelId}, not ${hotelId}` 
        });
      }

      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials for this hotel' 
      });
    }

    // ✅ STEP 3: Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log(`❌ Wrong password for: ${email}`);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid password' 
      });
    }

    // ✅ STEP 4: Check if user is active
    if (user.active === false) {
      return res.status(403).json({ 
        success: false, 
        error: 'Account is inactive' 
      });
    }

    // ✅ STEP 5: Generate token
    const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';
    const token = jwt.sign(
      {
        email: user.email,
        name: user.name,
        role: user.role,
        hotelId: hotelId,
        permissions: user.permissions
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ Login successful for hotel ${hotelId}: ${email}`);

    res.json({
      success: true,
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        hotelId: hotelId,
        permissions: user.permissions
      },
      hotelId: hotelId,
      hotelName: tenant.hotelName
    });

  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============ ROOM CONTROLLER ============
exports.getRooms = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.json({ success: true, data: [] });

    const rooms = await db.collection('rooms').find({ hotelId: req.hotelId }).toArray();
    rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createRoom = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const room = { 
      ...req.body, 
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date(),
      _version: 1
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId.toString();
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { ObjectId } = require('mongodb');
    const roomId = req.params.id;

    const filter = ObjectId.isValid(roomId) 
      ? { _id: new ObjectId(roomId), hotelId: req.hotelId }
      : { _id: roomId, hotelId: req.hotelId };

    const result = await db.collection('rooms').findOneAndUpdate(
      filter,
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Room not found' });
    if (result._id) result._id = result._id.toString();

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { ObjectId } = require('mongodb');
    const roomId = req.params.id;

    const filter = ObjectId.isValid(roomId) 
      ? { _id: new ObjectId(roomId), hotelId: req.hotelId }
      : { _id: roomId, hotelId: req.hotelId };

    await db.collection('rooms').deleteOne(filter);
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============ FOOD MENU CONTROLLER ============
exports.getFoodItems = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.json({ success: true, data: [] });

    const items = await db.collection('food').find({ hotelId: req.hotelId }).toArray();
    items.forEach(i => { if (i._id) i._id = i._id.toString(); });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createFoodItem = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const item = { 
      ...req.body, 
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date(),
      _version: 1
    };

    const result = await db.collection('food').insertOne(item);
    item._id = result.insertedId.toString();
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.updateFoodItem = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { ObjectId } = require('mongodb');
    const itemId = req.params.id;

    const filter = ObjectId.isValid(itemId) 
      ? { _id: new ObjectId(itemId), hotelId: req.hotelId }
      : { _id: itemId, hotelId: req.hotelId };

    const result = await db.collection('food').findOneAndUpdate(
      filter,
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Food item not found' });
    if (result._id) result._id = result._id.toString();

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.deleteFoodItem = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { ObjectId } = require('mongodb');
    const itemId = req.params.id;

    const filter = ObjectId.isValid(itemId) 
      ? { _id: new ObjectId(itemId), hotelId: req.hotelId }
      : { _id: itemId, hotelId: req.hotelId };

    await db.collection('food').deleteOne(filter);
    res.json({ success: true, message: 'Food item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============ HOTEL SETTINGS CONTROLLER ============
exports.getHotelSettings = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.json({ success: true, data: null });

    const hotel = await db.collection('tenants').findOne({ hotelId: req.hotelId });
    if (hotel && hotel._id) hotel._id = hotel._id.toString();
    res.json({ success: true, data: hotel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateHotelSettings = async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const result = await db.collection('tenants').findOneAndUpdate(
      { hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Hotel not found' });
    if (result._id) result._id = result._id.toString();

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};