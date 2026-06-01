const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');

// ============================================
// GET ALL GUESTS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    // Filter by the current hotel ID to ensure multi-tenant isolation
    const guests = await Guest.find({ hotelId: req.hotelId }).sort({ name: 1 });
    res.json({ success: true, data: guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ADD NEW GUEST
// ============================================
router.post('/', async (req, res) => {
  try {
    const { name, room, phone, email, points, status } = req.body;

    if (!name || !room) {
      return res.status(400).json({ success: false, error: 'Name and room are required' });
    }

    // Create new guest document with injected hotelId
    const guest = new Guest({ 
      ...req.body, 
      hotelId: req.hotelId, // 🔒 Critical: Scope to specific hotel
      points: points || 0,
      status: status || 'active'
    });
    await guest.save();

    // 🔄 Real-time sync to all admin devices for this hotel
    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guest_new', guest);

    res.status(201).json({ success: true, data: guest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE GUEST
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Find guest by ID and ensure it belongs to the current hotel
    const guest = await Guest.findOneAndUpdate(
      { _id: id, hotelId: req.hotelId },
      updates,
      { new: true }
    );

    if (!guest) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    // 🔄 Real-time sync
    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guest_upd', guest);

    res.json({ success: true, data: guest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE GUEST
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find and delete, ensuring hotel isolation
    const guest = await Guest.findOneAndDelete({ _id: id, hotelId: req.hotelId });

    if (!guest) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    // 🔄 Real-time sync
    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guest_del', { id, name: guest.name });

    res.json({ success: true, message: 'Guest removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;