const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL LOST & FOUND ITEMS (Guest View - Multi-Tenant)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const items = await db.collection('lostFound')
      .find({ hotelId: req.hotelId, status: { $ne: 'claimed' } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SINGLE ITEM
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const item = await db.collection('lostFound').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// REPORT LOST ITEM (Guest)
// ============================================
router.post('/', async (req, res) => {
  try {
    const { itemName, description, color, brand, lostLocation, lostDate, guestName, roomNumber, contact } = req.body;
    if (!itemName || !guestName || !roomNumber) {
      return res.status(400).json({ success: false, error: 'Item name, guest name and room number are required' });
    }

    const db = getDB();
    const item = {
      itemName,
      description: description || '',
      color: color || '',
      brand: brand || '',
      lostLocation: lostLocation || '',
      lostDate: lostDate ? new Date(lostDate) : new Date(),
      guestName,
      roomNumber,
      contact: contact || '',
      hotelId: req.hotelId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('lostFound').insertOne(item);
    item._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('lostFound_new', item);

    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE LOST ITEM REPORT (Guest)
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('lostFound').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('lostFound_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE LOST ITEM REPORT (Guest)
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('lostFound').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('lostFound_del', { id: req.params.id });

    res.json({ success: true, message: 'Item report removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
