const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET DIGITAL KEY BY ROOM (Multi-Tenant Isolated)
// ============================================
router.get('/room/:roomId', async (req, res) => {
  try {
    const db = getDB();
    const key = await db.collection('digitalKeys').findOne({
      roomId: req.params.roomId,
      hotelId: req.hotelId,
      isActive: true
    });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Digital key not found for this room' });
    }
    res.json({ success: true, data: key });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GENERATE NEW DIGITAL KEY
// ============================================
router.post('/generate', async (req, res) => {
  try {
    const { roomId, guestId, validDays } = req.body;
    if (!roomId || !guestId) {
      return res.status(400).json({ success: false, error: 'Room ID and Guest ID are required' });
    }

    const db = getDB();

    // Generate unique key
    const keyCode = generateKeyCode(roomId, guestId);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (validDays || 3));

    // Deactivate old keys for this room
    await db.collection('digitalKeys').updateMany(
      { roomId, hotelId: req.hotelId },
      { $set: { isActive: false, revokedAt: new Date() } }
    );

    const digitalKey = {
      roomId,
      guestId,
      keyCode,
      validUntil,
      hotelId: req.hotelId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('digitalKeys').insertOne(digitalKey);
    digitalKey._id = result.insertedId;

    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.hotelId}`).emit('key_new', digitalKey);
      io.to(`room_${roomId}`).emit('key_new', digitalKey);
    }

    res.status(201).json({ success: true, data: digitalKey });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// VALIDATE DIGITAL KEY
// ============================================
router.post('/validate', async (req, res) => {
  try {
    const { keyCode, roomId } = req.body;
    if (!keyCode || !roomId) {
      return res.status(400).json({ success: false, error: 'Key code and room ID are required' });
    }

    const db = getDB();
    const key = await db.collection('digitalKeys').findOne({
      keyCode,
      roomId,
      hotelId: req.hotelId,
      isActive: true
    });

    if (!key) {
      return res.status(401).json({ success: false, error: 'Invalid or expired key' });
    }

    if (key.validUntil && new Date() > new Date(key.validUntil)) {
      await db.collection('digitalKeys').updateOne(
        { _id: key._id },
        { $set: { isActive: false, revokedAt: new Date() } }
      );
      return res.status(401).json({ success: false, error: 'Key has expired' });
    }

    // Log access
    await db.collection('digitalKeys').updateOne(
      { _id: key._id },
      { $set: { lastUsed: new Date() } }
    );
    key.lastUsed = new Date();

    res.json({
      success: true,
      data: {
        roomId: key.roomId,
        valid: true,
        guestId: key.guestId
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET ALL ACTIVE KEYS (Admin)
// ============================================
router.get('/all', async (req, res) => {
  try {
    const db = getDB();
    const keys = await db.collection('digitalKeys')
      .find({
        hotelId: req.hotelId,
        isActive: true
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: keys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// REVOKE DIGITAL KEY
// ============================================
router.put('/:id/revoke', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('digitalKeys').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { isActive: false, revokedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Digital key not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('key_revoked', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// EXTEND KEY VALIDITY
// ============================================
router.put('/:id/extend', async (req, res) => {
  try {
    const { extraDays } = req.body;
    if (!extraDays || extraDays < 1) {
      return res.status(400).json({ success: false, error: 'Extra days are required' });
    }

    const db = getDB();
    const key = await db.collection('digitalKeys').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Digital key not found' });
    }

    const currentValidUntil = key.validUntil ? new Date(key.validUntil) : new Date();
    const newValidUntil = new Date(currentValidUntil);
    newValidUntil.setDate(newValidUntil.getDate() + extraDays);

    const result = await db.collection('digitalKeys').findOneAndUpdate(
      { _id: key._id },
      { $set: { validUntil: newValidUntil, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('key_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// HELPER: Generate Unique Key Code
// ============================================
function generateKeyCode(roomId, guestId) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const roomPart = roomId.toString().slice(-4).padStart(4, '0');
  const guestPart = guestId.toString().slice(-4).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `KEY-${roomPart}-${guestPart}-${timestamp.slice(-4)}-${random}`;
}

module.exports = router;
