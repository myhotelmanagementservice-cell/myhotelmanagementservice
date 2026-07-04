const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET CHAT HISTORY (Multi-Tenant Isolated)
// ============================================
router.get('/:roomId', async (req, res) => {
  try {
    const db = getDB();
    const messages = await db.collection('messages')
      .find({
        roomId: req.params.roomId,
        hotelId: req.hotelId
      })
      .sort({ createdAt: 1 })
      .toArray();
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// SEND NEW MESSAGE
// ============================================
router.post('/', async (req, res) => {
  try {
    const { roomId, sender, text } = req.body;
    if (!roomId || !text) {
      return res.status(400).json({ success: false, error: 'Room and text are required' });
    }

    const db = getDB();
    const message = {
      roomId,
      sender: sender || 'guest',
      text,
      hotelId: req.hotelId,
      createdAt: new Date(),
      read: false
    };
    const result = await db.collection('messages').insertOne(message);
    message._id = result.insertedId;

    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.hotelId}`).emit('new_message', message);
      io.to(`room_${roomId}`).emit('new_message', message);
    }

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// MARK MESSAGE AS READ
// ============================================
router.put('/:id/read', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('messages').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { read: true, readAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('message_read', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET UNREAD MESSAGE COUNT
// ============================================
router.get('/unread/:roomId', async (req, res) => {
  try {
    const db = getDB();
    const count = await db.collection('messages').countDocuments({
      roomId: req.params.roomId,
      hotelId: req.hotelId,
      read: false
    });
    res.json({ success: true, data: { unread: count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE MESSAGE
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('messages').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('message_del', { id: req.params.id });

    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
