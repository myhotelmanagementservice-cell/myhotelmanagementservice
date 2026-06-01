const express = require('express');
const router = express.Router();
const Food = require('../models/Food');
const { protect, authorize } = require('../middleware/auth');

// 🔹 GET all food items (multi-tenant scoped)
router.get('/', protect, async (req, res) => {
  try {
    const { category, search, limit = 50, page = 1 } = req.query;
    const query = { hotelId: req.hotelId };

    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [items, total] = await Promise.all([
      Food.find(query).sort({ name: 1 }).limit(parseInt(limit)).skip(skip),
      Food.countDocuments(query)
    ]);

    res.json({ 
      success: true, 
      data: items, 
      pagination: { 
        total, 
        page: parseInt(page), 
        limit: parseInt(limit), 
        pages: Math.ceil(total / parseInt(limit)) 
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch food items', message: err.message });
  }
});

// 🔹 POST create new food item
router.post('/', protect, authorize('admin', 'manager', 'restaurant'), async (req, res) => {
  try {
    const { name, price, category, description, available, emoji } = req.body;

    if (!name || price == null) {
      return res.status(400).json({ success: false, error: 'Name and price are required' });
    }

    const item = new Food({
      ...req.body,
      hotelId: req.hotelId,
      price: parseFloat(price),
      available: available !== false
    });

    await item.save();

    // 🔄 Real-time broadcast to all clients in this hotel
    req.app.get('io').to(`hotel_${req.hotelId}`).emit('food_new', item);

    // 📝 Audit log
    req.app.get('logger')?.info({ hotelId: req.hotelId, action: 'food_created', userId: req.user.id, details: item.name });

    res.status(201).json({ success: true, message: 'Food item created', data: item });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: 'Validation failed', message: err.message });
    }
    res.status(500).json({ success: false, error: 'Failed to create food item', message: err.message });
  }
});

// 🔹 PUT update existing food item
router.put('/:id', protect, authorize('admin', 'manager', 'restaurant'), async (req, res) => {
  try {
    const item = await Food.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!item) return res.status(404).json({ success: false, error: 'Food item not found' });

    const updateData = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.price !== undefined) updateData.price = parseFloat(req.body.price);
    if (req.body.category) updateData.category = req.body.category;
    if (req.body.description !== undefined) updateData.description = req.body.description;
    if (req.body.available !== undefined) updateData.available = req.body.available;
    if (req.body.emoji) updateData.emoji = req.body.emoji;

    Object.assign(item, updateData);
    await item.save();

    req.app.get('io').to(`hotel_${req.hotelId}`).emit('food_upd', item);
    req.app.get('logger')?.info({ hotelId: req.hotelId, action: 'food_updated', userId: req.user.id, details: item.name });

    res.json({ success: true, message: 'Food item updated', data: item });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: 'Validation failed', message: err.message });
    }
    res.status(500).json({ success: false, error: 'Failed to update food item', message: err.message });
  }
});

// 🔹 DELETE food item
router.delete('/:id', protect, authorize('admin', 'manager'), async (req, res) => {
  try {
    const item = await Food.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!item) return res.status(404).json({ success: false, error: 'Food item not found' });

    req.app.get('io').to(`hotel_${req.hotelId}`).emit('food_del', { id: req.params.id, name: item.name });
    req.app.get('logger')?.info({ hotelId: req.hotelId, action: 'food_deleted', userId: req.user.id, details: item.name });

    res.json({ success: true, message: 'Food item deleted', data: { id: req.params.id, name: item.name } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete food item', message: err.message });
  }
});

module.exports = router;
