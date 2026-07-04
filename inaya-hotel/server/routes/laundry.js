const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL LAUNDRY ORDERS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection('laundry')
      .find({ hotelId: req.hotelId })
      .sort({ createdAt: -1 })
      .toArray();

    // Get guest details for each order
    const guestIds = orders.map(o => o.guestId);
    const guests = await db.collection('guests')
      .find({ _id: { $in: guestIds.map(id => new ObjectId(id)) } })
      .toArray();

    const guestMap = {};
    guests.forEach(g => {
      guestMap[g._id.toString()] = { name: g.name, room: g.room };
    });

    const enrichedOrders = orders.map(o => ({
      ...o,
      guest: guestMap[o.guestId] || { name: 'Unknown', room: 'N/A' }
    }));

    res.json({ success: true, data: enrichedOrders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET LAUNDRY BY GUEST
// ============================================
router.get('/guest/:guestId', async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection('laundry')
      .find({
        guestId: req.params.guestId,
        hotelId: req.hotelId
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET LAUNDRY BY STATUS
// ============================================
router.get('/status/:status', async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection('laundry')
      .find({
        status: req.params.status,
        hotelId: req.hotelId
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE LAUNDRY ORDER
// ============================================
router.post('/', async (req, res) => {
  try {
    const { guestId, items, total, specialInstructions } = req.body;
    if (!guestId || !items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Guest ID and items are required' });
    }

    const db = getDB();
    const laundry = {
      guestId,
      items,
      total: total || 0,
      specialInstructions: specialInstructions || '',
      hotelId: req.hotelId,
      status: 'pending',
      orderNumber: `LAU-${Date.now().toString().slice(-6)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('laundry').insertOne(laundry);
    laundry._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('laundry_new', laundry);

    res.status(201).json({ success: true, data: laundry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE LAUNDRY STATUS
// ============================================
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const db = getDB();
    const updateData = {
      status,
      updatedAt: new Date()
    };
    if (status === 'ready') updateData.readyAt = new Date();
    if (status === 'delivered') updateData.deliveredAt = new Date();

    const result = await db.collection('laundry').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Laundry order not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('laundry_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE LAUNDRY ORDER
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('laundry').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Laundry order not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('laundry_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE LAUNDRY ORDER
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('laundry').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Laundry order not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('laundry_del', { id: req.params.id });

    res.json({ success: true, message: 'Laundry order removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
