const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL CITY GUIDE ENTRIES (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const guides = await db.collection('cityGuide')
      .find({ hotelId: req.hotelId })
      .sort({ category: 1, name: 1 })
      .toArray();
    res.json({ success: true, data: guides });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET BY CATEGORY
// ============================================
router.get('/category/:category', async (req, res) => {
  try {
    const db = getDB();
    const guides = await db.collection('cityGuide')
      .find({
        category: req.params.category,
        hotelId: req.hotelId
      })
      .sort({ name: 1 })
      .toArray();
    res.json({ success: true, data: guides });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SINGLE ENTRY
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const guide = await db.collection('cityGuide').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!guide) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }
    res.json({ success: true, data: guide });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE CITY GUIDE ENTRY (Admin Only)
// ============================================
router.post('/', async (req, res) => {
  try {
    const { name, category, description, address, phone, website, image, rating } = req.body;
    if (!name || !category || !description) {
      return res.status(400).json({ success: false, error: 'Name, category and description are required' });
    }

    const db = getDB();
    const guide = {
      name,
      category,
      description,
      address: address || '',
      phone: phone || '',
      website: website || '',
      image: image || '',
      rating: rating || 0,
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('cityGuide').insertOne(guide);
    guide._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guide_new', guide);

    res.status(201).json({ success: true, data: guide });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE CITY GUIDE ENTRY
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('cityGuide').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guide_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE CITY GUIDE ENTRY
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('cityGuide').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Entry not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('guide_del', { id: req.params.id });

    res.json({ success: true, message: 'Entry removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
