const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ROOM STATUS (Multi-Tenant Isolated)
// ============================================
router.get('/:roomId', async (req, res) => {
  try {
    const db = getDB();
    const room = await db.collection('rooms').findOne({
      roomNumber: req.params.roomId,
      hotelId: req.hotelId
    });
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    res.json({
      success: true,
      data: {
        temperature: room.temperature || 22,
        lights: room.lights || 'on',
        ac: room.ac || 'auto',
        status: room.status
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE ROOM TEMPERATURE
// ============================================
router.put('/:roomId/temperature', async (req, res) => {
  try {
    const { temperature } = req.body;
    if (!temperature || temperature < 16 || temperature > 30) {
      return res.status(400).json({ success: false, error: 'Temperature must be between 16-30°C' });
    }

    const db = getDB();
    const result = await db.collection('rooms').findOneAndUpdate(
      { roomNumber: req.params.roomId, hotelId: req.hotelId },
      { $set: { temperature } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('room_temp_upd', {
      roomId: req.params.roomId,
      temperature
    });

    res.json({ success: true, data: { roomId: req.params.roomId, temperature } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE ROOM LIGHTS
// ============================================
router.put('/:roomId/lights', async (req, res) => {
  try {
    const { lights } = req.body;
    if (!['on', 'off', 'dim'].includes(lights)) {
      return res.status(400).json({ success: false, error: 'Lights must be on/off/dim' });
    }

    const db = getDB();
    const result = await db.collection('rooms').findOneAndUpdate(
      { roomNumber: req.params.roomId, hotelId: req.hotelId },
      { $set: { lights } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('room_lights_upd', {
      roomId: req.params.roomId,
      lights
    });

    res.json({ success: true, data: { roomId: req.params.roomId, lights } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE ROOM AC MODE
// ============================================
router.put('/:roomId/ac', async (req, res) => {
  try {
    const { ac } = req.body;
    if (!['auto', 'cool', 'heat', 'fan', 'off'].includes(ac)) {
      return res.status(400).json({ success: false, error: 'Invalid AC mode' });
    }

    const db = getDB();
    const result = await db.collection('rooms').findOneAndUpdate(
      { roomNumber: req.params.roomId, hotelId: req.hotelId },
      { $set: { ac } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('room_ac_upd', {
      roomId: req.params.roomId,
      ac
    });

    res.json({ success: true, data: { roomId: req.params.roomId, ac } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
