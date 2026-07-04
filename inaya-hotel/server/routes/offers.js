const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL OFFERS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const offers = await db.collection('offers')
      .find({ hotelId: req.hotelId })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: offers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SINGLE OFFER
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const offer = await db.collection('offers').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!offer) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.json({ success: true, data: offer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE OFFER (Admin Only)
// ============================================
router.post('/', async (req, res) => {
  try {
    const { title, description, discount, validUntil, code } = req.body;
    if (!title || !discount) {
      return res.status(400).json({ success: false, error: 'Title and discount are required' });
    }

    const db = getDB();
    const offer = {
      ...req.body,
      hotelId: req.hotelId,
      active: true,
      createdAt: new Date()
    };
    const result = await db.collection('offers').insertOne(offer);
    offer._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('offer_new', offer);

    res.status(201).json({ success: true, data: offer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE OFFER
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('offers').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: req.body },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('offer_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE OFFER
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('offers').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('offer_del', { id: req.params.id });

    res.json({ success: true, message: 'Offer removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
