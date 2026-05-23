const express = require('express');
const router = express.Router();

// Get all rooms
router.get('/', async (req, res) => {
  try {
    const Room = require('../models/Room');
    const rooms = await Room.find({ hotelId: req.headers['x-hotel-id'] || 'CPH001' });
    res.json({ success: true, data: rooms });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
