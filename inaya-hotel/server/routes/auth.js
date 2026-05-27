const express = require('express');
const Guest = require("../models/Guest");
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    user.lastLogin = new Date();
    await user.save();
    
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, hotelId: user.hotelId },
      process.env.JWT_SECRET || 'inaya_hotel_super_secret_key_2025_secure',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, hotelId: user.hotelId }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, hotelId } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }
    const user = new User({ name, email, password, role: role || 'staff', hotelId: hotelId || 'INH001' });
    await user.save();
    res.json({ success: true, message: 'User created successfully', user: { id: user._id, name, email, role: user.role } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'inaya_hotel_super_secret_key_2025_secure');
    const user = await User.findById(decoded.userId).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

module.exports = router;

// Guest login - Create or find guest
router.post('/loginGuest', async (req, res) => {
  try {
    const { name, room } = req.body;
    if (!name || !room) {
      return res.status(400).json({ success: false, error: 'Name and room required' });
    }
    
    // Find or create guest
    let guest = await Guest.findOne({ room, status: 'active' });
    if (!guest) {
      guest = new Guest({ name, room, points: 50, status: 'active', checkin: new Date() });
      await guest.save();
    } else {
      guest.name = name;
      await guest.save();
    }
    
    res.json({
      success: true,
      guest: { id: guest._id, name: guest.name, room: guest.room, points: guest.points }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
