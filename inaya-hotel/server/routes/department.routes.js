const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// ✅ FIX: ID ko safely parse karo — ObjectId ya string dono handle karo
const parseId = (id) => {
  if (!id) return id;
  try {
    return ObjectId.isValid(id) && String(id).length === 24 ? new ObjectId(id) : id;
  } catch (e) {
    return id;
  }
};

// ============================================
// GET: Fetch all departments
// ============================================
router.get('/', async (req, res) => {
  try {
    const hotelId = getHotelId(req);
    const db = req.app.get('db');

    if (!db) return res.json([]);

    const departments = await db.collection('departments')
      .find({ hotelId })
      .sort({ createdAt: 1 })
      .toArray();

    // ✅ FIX: Direct array return — frontend Array.isArray() check pass ho
    res.json(departments);
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ error: 'Server error fetching departments' });
  }
});

// ============================================
// POST: Create a new department
// ============================================
router.post('/', async (req, res) => {
  try {
    const hotelId = getHotelId(req);
    const db = req.app.get('db');

    if (!db) return res.status(503).json({ error: 'Database not connected' });

    const data = {
      ...req.body,
      hotelId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // ✅ FIX: key se check karo — duplicate department mat bano
    if (data.key) {
      const exists = await db.collection('departments').findOne({
        hotelId,
        key: data.key
      });
      if (exists) {
        // ✅ FIX: Duplicate ki jagah existing return karo — error mat do
        return res.status(200).json(exists);
      }
    }

    const result = await db.collection('departments').insertOne(data);
    const savedDept = { ...data, _id: result.insertedId };

    // Real-time broadcast
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${hotelId}`).emit('dept_upd', {
        action: 'create',
        data: savedDept,
        syncToken: Date.now(),
        clientId: req.headers['x-client-id']
      });
    }

    res.status(201).json(savedDept);
  } catch (err) {
    console.error('Error creating department:', err);
    res.status(500).json({ error: 'Server error creating department' });
  }
});

// ============================================
// PUT: Update a department by ID or key
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const hotelId = getHotelId(req);
    const db = req.app.get('db');
    const { id } = req.params;

    if (!db) return res.status(503).json({ error: 'Database not connected' });

    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id;
    delete updateData.hotelId;

    // ✅ FIX: Pehle _id se dhundho, nahi mila to key se dhundho
    let result = null;

    const parsedId = parseId(id);

    if (typeof parsedId === 'object') {
      // ObjectId hai — _id se find karo
      result = await db.collection('departments').findOneAndUpdate(
        { _id: parsedId, hotelId },
        { $set: updateData },
        { returnDocument: 'after' }
      );
    }

    // ✅ FIX: Agar ObjectId se nahi mila to key se try karo
    if (!result) {
      result = await db.collection('departments').findOneAndUpdate(
        { $or: [{ key: id }, { _id: id }], hotelId },
        { $set: updateData },
        { returnDocument: 'after', upsert: false }
      );
    }

    // ✅ FIX: Agar abhi bhi nahi mila to insert karo (upsert)
    if (!result) {
      const newData = {
        ...req.body,
        ...updateData,
        hotelId,
        createdAt: new Date()
      };
      const insertResult = await db.collection('departments').insertOne(newData);
      result = { ...newData, _id: insertResult.insertedId };
    }

    // Real-time broadcast
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${hotelId}`).emit('dept_upd', {
        action: 'update',
        data: result,
        syncToken: Date.now(),
        clientId: req.headers['x-client-id']
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Error updating department:', err);
    res.status(500).json({ error: 'Server error updating department' });
  }
});

// ============================================
// DELETE: Delete a department
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const hotelId = getHotelId(req);
    const db = req.app.get('db');
    const { id } = req.params;

    if (!db) return res.status(503).json({ error: 'Database not connected' });

    // ✅ FIX: _id ya key dono se delete karo
    const parsedId = parseId(id);

    let result;
    if (typeof parsedId === 'object') {
      result = await db.collection('departments').deleteOne({
        _id: parsedId,
        hotelId
      });
    }

    if (!result || result.deletedCount === 0) {
      result = await db.collection('departments').deleteOne({
        $or: [{ key: id }, { _id: id }],
        hotelId
      });
    }

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Real-time broadcast
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${hotelId}`).emit('dept_upd', {
        action: 'delete',
        data: { _id: id },
        syncToken: Date.now(),
        clientId: req.headers['x-client-id']
      });
    }

    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (err) {
    console.error('Error deleting department:', err);
    res.status(500).json({ error: 'Server error deleting department' });
  }
});

module.exports = router;