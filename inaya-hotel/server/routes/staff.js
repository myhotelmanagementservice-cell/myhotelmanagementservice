const express = require('express');
const router = express.Router();
const Staff = require('../models/Staff');

// Get all staff for a hotel
router.get('/', async (req, res) => {
  try {
    const hotelId = req.headers['x-hotel-id'] || req.query.hotelId || 'default';
    const staff = await Staff.find({ hotelId }).sort({ createdAt: -1 });
    res.json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new staff member
router.post('/', async (req, res) => {
  try {
    const hotelId = req.headers['x-hotel-id'] || req.body.hotelId || 'default';
    const { name, role, department, joinDate, shift } = req.body;
    if (!name || !role) {
      return res.status(400).json({ success: false, error: 'Name and role are required' });
    }
    const staff = new Staff({
      hotelId,
      name,
      role,
      department: department || 'General',
      joinDate: joinDate || new Date(),
      shift: shift || 'morning'
    });
    await staff.save();
    res.status(201).json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update staff
router.put('/:id', async (req, res) => {
  try {
    const hotelId = req.headers['x-hotel-id'] || req.body.hotelId || 'default';
    const { id } = req.params;
    const updates = req.body;
    const staff = await Staff.findOneAndUpdate(
      { _id: id, hotelId },
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    );
    if (!staff) return res.status(404).json({ success: false, error: 'Staff not found' });
    res.json({ success: true, data: staff });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete staff
router.delete('/:id', async (req, res) => {
  try {
    const hotelId = req.headers['x-hotel-id'] || req.query.hotelId || 'default';
    const { id } = req.params;
    const result = await Staff.findOneAndDelete({ _id: id, hotelId });
    if (!result) return res.status(404).json({ success: false, error: 'Staff not found' });
    res.json({ success: true, message: 'Staff deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
