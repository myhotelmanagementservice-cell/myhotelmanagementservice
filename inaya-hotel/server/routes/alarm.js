const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL ALARMS FOR A ROOM (Multi-Tenant Isolated)
// ============================================
router.get('/room/:roomId', async (req, res) => {
  try {
    const db = getDB();
    const alarms = await db.collection('alarms')
      .find({
        roomId: req.params.roomId,
        hotelId: req.hotelId
      })
      .sort({ time: 1 })
      .toArray();
    res.json({ success: true, data: alarms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// SET ALARM
// ============================================
router.post('/', async (req, res) => {
  try {
    const { roomId, time, label, repeat } = req.body;
    if (!roomId || !time) {
      return res.status(400).json({ success: false, error: 'Room and time are required' });
    }

    const db = getDB();
    const alarm = {
      roomId,
      time,
      label: label || 'Wake up',
      repeat: repeat || 'once',
      hotelId: req.hotelId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('alarms').insertOne(alarm);
    alarm._id = result.insertedId;

    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.hotelId}`).emit('alarm_new', alarm);
      io.to(`room_${roomId}`).emit('alarm_new', alarm);
    }

    res.status(201).json({ success: true, data: alarm });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// TOGGLE ALARM (ON/OFF)
// ============================================
router.put('/:id/toggle', async (req, res) => {
  try {
    const db = getDB();
    const alarm = await db.collection('alarms').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!alarm) {
      return res.status(404).json({ success: false, error: 'Alarm not found' });
    }

    const result = await db.collection('alarms').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          isActive: !alarm.isActive,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('alarm_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE ALARM
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const { time, label, repeat } = req.body;
    const db = getDB();

    const result = await db.collection('alarms').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      {
        $set: {
          time: time || undefined,
          label: label || undefined,
          repeat: repeat || undefined,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Alarm not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('alarm_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE ALARM
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('alarms').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Alarm not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('alarm_del', { id: req.params.id });

    res.json({ success: true, message: 'Alarm deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
