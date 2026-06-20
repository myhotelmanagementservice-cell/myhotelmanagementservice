const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Fetch all departments
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const departments = await db.collection('departments').find({ hotelId }).sort({ createdAt: 1 }).toArray();
        res.json(departments);
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ error: 'Server error fetching departments' });
    }
});

// POST: Create a new department
router.post('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const data = { ...req.body, hotelId, createdAt: new Date(), updatedAt: new Date() };

        const exists = await db.collection('departments').findOne({ hotelId, key: data.key });
        if (exists) return res.status(400).json({ error: 'Department key already exists for this hotel' });

        const result = await db.collection('departments').insertOne(data);
        const savedDept = { ...data, _id: result.insertedId };

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

// PUT: Update a department
router.put('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const updateData = { ...req.body, updatedAt: new Date() };
        delete updateData._id;
        delete updateData.hotelId;

        const result = await db.collection('departments').findOneAndUpdate(
            { _id: new ObjectId(req.params.id), hotelId },
            { $set: updateData },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ error: 'Department not found' });

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

// DELETE: Delete a department
router.delete('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');

        const result = await db.collection('departments').deleteOne({ _id: new ObjectId(req.params.id), hotelId });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Department not found' });

        const io = req.app.get('io');
        if (io) {
            io.to(`hotel_${hotelId}`).emit('dept_upd', {
                action: 'delete',
                data: { _id: req.params.id },
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