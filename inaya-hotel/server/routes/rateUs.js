const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL RATINGS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const ratings = await db.collection('ratings')
      .find({ hotelId: req.hotelId })
      .sort({ createdAt: -1 })
      .toArray();
    
    // Get guest details for each rating
    const guestIds = ratings.map(r => r.guestId);
    const guests = await db.collection('guests')
      .find({ _id: { $in: guestIds.map(id => new ObjectId(id)) } })
      .toArray();
    
    const guestMap = {};
    guests.forEach(g => {
      guestMap[g._id.toString()] = { name: g.name, room: g.room };
    });

    const enrichedRatings = ratings.map(r => ({
      ...r,
      guest: guestMap[r.guestId] || { name: 'Unknown', room: 'N/A' }
    }));

    res.json({ success: true, data: enrichedRatings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET AVERAGE RATING
// ============================================
router.get('/average', async (req, res) => {
  try {
    const db = getDB();
    const ratings = await db.collection('ratings')
      .find({ hotelId: req.hotelId })
      .toArray();

    const total = ratings.length;
    if (total === 0) {
      return res.json({ 
        success: true, 
        data: { average: 0, total: 0, distribution: [] } 
      });
    }

    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    const average = Math.round((sum / total) * 10) / 10;
    const distribution = ratings.map(r => r.rating);

    res.json({ 
      success: true, 
      data: { average, total, distribution } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// SUBMIT RATING
// ============================================
router.post('/', async (req, res) => {
  try {
    const { guestId, roomNumber, rating, comment, category } = req.body;
    if (!guestId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Guest ID and rating (1-5) are required' 
      });
    }

    const db = getDB();

    // Check if guest already rated
    const existing = await db.collection('ratings').findOne({
      guestId,
      hotelId: req.hotelId
    });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: 'You have already submitted a rating' 
      });
    }

    const newRating = {
      guestId,
      roomNumber: roomNumber || 'N/A',
      rating: parseInt(rating),
      comment: comment || '',
      category: category || 'general',
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('ratings').insertOne(newRating);
    newRating._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('rating_new', newRating);

    res.status(201).json({ success: true, data: newRating });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE RATING
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1-5' });
    }

    const db = getDB();
    const result = await db.collection('ratings').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { rating: parseInt(rating), comment, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Rating not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('rating_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE RATING
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('ratings').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Rating not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('rating_del', { id: req.params.id });

    res.json({ success: true, message: 'Rating removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
