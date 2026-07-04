const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET ALL MENU ITEMS (Multi-Tenant Isolated)
// ============================================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const menu = await db.collection('menu')
      .find({ hotelId: req.hotelId })
      .sort({ category: 1, name: 1 })
      .toArray();
    res.json({ success: true, data: menu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET MENU BY CATEGORY
// ============================================
router.get('/category/:category', async (req, res) => {
  try {
    const db = getDB();
    const menu = await db.collection('menu')
      .find({
        category: req.params.category,
        hotelId: req.hotelId
      })
      .sort({ name: 1 })
      .toArray();
    res.json({ success: true, data: menu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET SINGLE MENU ITEM
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const item = await db.collection('menu').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Menu item not found' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE MENU ITEM (Admin Only)
// ============================================
router.post('/', async (req, res) => {
  try {
    const { name, category, price, description, image, isAvailable } = req.body;
    if (!name || !category || !price) {
      return res.status(400).json({ success: false, error: 'Name, category and price are required' });
    }

    const db = getDB();
    const menuItem = {
      name,
      category,
      price: parseFloat(price),
      description: description || '',
      image: image || '',
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      hotelId: req.hotelId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('menu').insertOne(menuItem);
    menuItem._id = result.insertedId;

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('menu_new', menuItem);

    res.status(201).json({ success: true, data: menuItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// UPDATE MENU ITEM
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('menu').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), hotelId: req.hotelId },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Menu item not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('menu_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// TOGGLE AVAILABILITY
// ============================================
router.put('/:id/toggle', async (req, res) => {
  try {
    const db = getDB();
    const item = await db.collection('menu').findOne({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!item) {
      return res.status(404).json({ success: false, error: 'Menu item not found' });
    }

    const result = await db.collection('menu').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          isAvailable: !item.isAvailable,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('menu_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// DELETE MENU ITEM
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('menu').findOneAndDelete({
      _id: new ObjectId(req.params.id),
      hotelId: req.hotelId
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'Menu item not found' });
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('menu_del', { id: req.params.id });

    res.json({ success: true, message: 'Menu item removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
