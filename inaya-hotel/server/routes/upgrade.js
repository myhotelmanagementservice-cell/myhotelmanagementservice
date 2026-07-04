const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL UPGRADE REQUESTS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const upgrades = await db.collection('upgrades')
      .find({ hotelId: req.hotelId })
      .sort({ createdAt: -1 })
      .toArray();

    // Get guest details
    const guestIds = upgrades.map(u => u.guestId);
    const guests = await db.collection('guests')
      .find({ _id: { $in: guestIds.map(id => new ObjectId(id)) } })
      .toArray();

    const guestMap = {};
    guests.forEach(g => {
      guestMap[g._id.toString()] = { name: g.name, room: g.room };
    });

    const enrichedUpgrades = upgrades.map(u => ({
      ...u,
      guest: guestMap[u.guestId] || { name: 'Unknown', room: 'N/A' }
    }));

    res.json({ success: true, data: enrichedUpgrades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET UPGRADE BY GUEST
// ============================================
router.get('/guest/:guestId', async (req, res) => {
  try {
    const db = getDB();
    const upgrades = await db.collection('upgrades')
      .find({
        guestId: req.params.guestId,
        hotelId: req.hotelId
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: upgrades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// REQUEST ROOM UPGRADE
// ============================================
router.post('/', async (req, res) => {
  try {
    const { guestId, currentRoom, requestedRoom, reason, preferredDate } = req.body;
    if (!guestId || !currentRoom || !requestedRoom) {
      return res.status(400).json({
        success: false,
        error: 'Guest ID, current room and requested room are required'
      });
    }

    const db = getDB();

    // Check if guest exists
    const guest = await db.collection('guests').findOne({
      _id: new ObjectId(guestId),
      hotelId: req.hotelId
    });
    if (!guest) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    // Check if upgrade already requested
    const existing = await db.collection('upgrades').findOne({
      guestId,
      hotelId: req.hotelId,
      status: 'pending'
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'You already have a pending upgrade request'
      });
    }

    const upgrade = {
      guestId,
      currentRoom,
      requestedRoom,
      reason: reason || '',
      preferredDate: preferredDate ? new Date(preferredDate) : new Date(),
      hotelId: req.hotelId,
      status: 'pending',
      requestDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('upgrades').insertOne(upgrade);
    upgrade._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('upgrade_new', upgrade);

    res.status(201).json({ success: true, data: upgrade });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// APPROVE UPGRADE REQUEST
// ============================================
router.put('/:id/approve', async (req, res) => {
  try {
    const db = getDB();
    const upgrade = await db.collection('upgrades').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!upgrade) {
      return res.status(404).json({ success: false, error: 'Upgrade request not found' });
    }

    // Update upgrade status
    const result = await db.collection('upgrades').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: 'approved',
          approvedDate: new Date(),
          approvedBy: req.user?.name || 'Admin',
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    // Update guest's room
    await db.collection('guests').findOneAndUpdate(
      { _id: new ObjectId(upgrade.guestId), hotelId: req.hotelId },
      { $set: { room: upgrade.requestedRoom, updatedAt: new Date() } }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.hotelId}`).emit('upgrade_approved', result);
      io.to(`room_${upgrade.currentRoom}`).emit('upgrade_approved', result);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// REJECT UPGRADE REQUEST
// ============================================
router.put('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const db = getDB();
    const result = await db.collection('upgrades').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      {
        $set: {
          status: 'rejected',
          rejectedDate: new Date(),
          rejectionReason: reason || 'Not available',
          approvedBy: req.user?.name || 'Admin',
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Upgrade request not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('upgrade_rejected', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CANCEL UPGRADE REQUEST
// ============================================
router.put('/:id/cancel', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('upgrades').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      {
        $set: {
          status: 'cancelled',
          cancelledDate: new Date(),
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Upgrade request not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('upgrade_cancelled', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE UPGRADE REQUEST
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('upgrades').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Upgrade request not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('upgrade_del', { id: req.params.id });

    res.json({ success: true, message: 'Upgrade request removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
