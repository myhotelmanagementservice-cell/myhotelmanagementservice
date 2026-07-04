const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL SPA SERVICES (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const services = await db.collection('spa')
      .find({ hotelId: req.hotelId })
      .sort({ name: 1 })
      .toArray();
    res.json({ success: true, data: services });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SINGLE SPA SERVICE
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const service = await db.collection('spa').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!service) {
      return res.status(404).json({ success: false, error: 'Spa service not found' });
    }
    res.json({ success: true, data: service });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE SPA SERVICE (Admin Only)
// ============================================
router.post('/', async (req, res) => {
  try {
    const { name, description, price, duration, image, isAvailable } = req.body;
    if (!name || !price || !duration) {
      return res.status(400).json({ success: false, error: 'Name, price and duration are required' });
    }

    const db = getDB();
    const spa = {
      name,
      description: description || '',
      price: parseFloat(price),
      duration,
      image: image || '',
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('spa').insertOne(spa);
    spa._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('spa_new', spa);

    res.status(201).json({ success: true, data: spa });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE SPA SERVICE
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('spa').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Spa service not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('spa_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// BOOK SPA APPOINTMENT
// ============================================
router.post('/book', async (req, res) => {
  try {
    const { serviceId, guestName, roomNumber, date, time } = req.body;
    if (!serviceId || !guestName || !roomNumber || !date || !time) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const db = getDB();
    const booking = {
      serviceId,
      guestName,
      roomNumber,
      date,
      time,
      hotelId: req.hotelId,
      status: 'confirmed',
      bookedAt: new Date()
    };
    const result = await db.collection('spa_bookings').insertOne(booking);
    booking._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('spa_booking', booking);

    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SPA BOOKINGS
// ============================================
router.get('/bookings/all', async (req, res) => {
  try {
    const db = getDB();
    const bookings = await db.collection('spa_bookings')
      .find({ hotelId: req.hotelId })
      .sort({ bookedAt: -1 })
      .toArray();
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CANCEL SPA BOOKING
// ============================================
router.put('/bookings/:id/cancel', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('spa_bookings').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('spa_booking_cancelled', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE SPA SERVICE
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('spa').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Spa service not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('spa_del', { id: req.params.id });

    res.json({ success: true, message: 'Spa service removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
