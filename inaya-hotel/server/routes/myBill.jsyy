const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

// ============================================
// GET GUEST BILL (Multi-Tenant Isolated)
// ============================================
router.get('/:guestId', async (req, res) => {
  try {
    const db = getDB();
    const bill = await db.collection('bills').findOne({
      guestId: req.params.guestId,
      hotelId: req.hotelId
    });
    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }
    res.json({ success: true, data: bill });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// CREATE/UPDATE BILL
// ============================================
router.post('/', async (req, res) => {
  try {
    const { guestId, items, total } = req.body;
    if (!guestId || !items || !total) {
      return res.status(400).json({ success: false, error: 'GuestId, items and total are required' });
    }

    const db = getDB();
    let bill = await db.collection('bills').findOne({
      guestId,
      hotelId: req.hotelId
    });

    if (bill) {
      // Update existing bill
      const result = await db.collection('bills').findOneAndUpdate(
        { _id: bill._id },
        {
          $set: {
            items,
            total,
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );
      bill = result;
    } else {
      // Create new bill
      const newBill = {
        guestId,
        items,
        total,
        hotelId: req.hotelId,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const result = await db.collection('bills').insertOne(newBill);
      newBill._id = result.insertedId;
      bill = newBill;
    }

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('bill_upd', bill);

    res.status(201).json({ success: true, data: bill });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ADD ITEM TO BILL
// ============================================
router.put('/:guestId/add-item', async (req, res) => {
  try {
    const { item, price } = req.body;
    if (!item || !price) {
      return res.status(400).json({ success: false, error: 'Item and price are required' });
    }

    const db = getDB();
    const bill = await db.collection('bills').findOne({
      guestId: req.params.guestId,
      hotelId: req.hotelId
    });
    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    const newItem = { item, price, addedAt: new Date() };
    const newTotal = (bill.total || 0) + price;

    const result = await db.collection('bills').findOneAndUpdate(
      { _id: bill._id },
      {
        $push: { items: newItem },
        $set: { total: newTotal, updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('bill_upd', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// PAY BILL
// ============================================
router.put('/:guestId/pay', async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const db = getDB();
    const bill = await db.collection('bills').findOne({
      guestId: req.params.guestId,
      hotelId: req.hotelId
    });
    if (!bill) {
      return res.status(404).json({ success: false, error: 'Bill not found' });
    }

    const result = await db.collection('bills').findOneAndUpdate(
      { _id: bill._id },
      {
        $set: {
          status: 'paid',
          paidAt: new Date(),
          paymentMethod: paymentMethod || 'cash'
        }
      },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) io.to(`hotel_${req.hotelId}`).emit('bill_paid', result);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET BILL SUMMARY (Admin)
// ============================================
router.get('/summary/all', async (req, res) => {
  try {
    const db = getDB();
    const bills = await db.collection('bills')
      .find({ hotelId: req.hotelId })
      .toArray();

    const summary = {
      totalBills: bills.length,
      paidBills: bills.filter(b => b.status === 'paid').length,
      pendingBills: bills.filter(b => b.status === 'pending').length,
      totalRevenue: bills
        .filter(b => b.status === 'paid')
        .reduce((sum, b) => sum + (b.total || 0), 0),
      pendingAmount: bills
        .filter(b => b.status === 'pending')
        .reduce((sum, b) => sum + (b.total || 0), 0)
    };

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
