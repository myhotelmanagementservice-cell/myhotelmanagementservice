const express = require('express');
const router = express.Router();
const Department = require('../models/Department'); // Apne model ka path adjust karein

// Helper: Frontend se hotelId query ya header se aata hai
const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// ✅ GET: Fetch all departments for a specific hotel
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const departments = await Department.find({ hotelId }).sort({ createdAt: 1 });
        res.json(departments);
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ error: 'Server error fetching departments' });
    }
});

// ✅ POST: Create a new department
router.post('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const data = { ...req.body, hotelId };

        // Check if department key already exists for this hotel
        const exists = await Department.findOne({ hotelId, key: data.key });
        if (exists) {
            return res.status(400).json({ error: 'Department key already exists for this hotel' });
        }

        const newDept = new Department(data);
        const savedDept = await newDept.save();

        // Emit Socket Event for Real-Time Sync
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

// ✅ PUT: Update an existing department (or its categories)
router.put('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);

        // Update karte waqt hotelId change nahi hone dena chahiye
        const updateData = { ...req.body, hotelId }; 
        delete updateData._id; // MongoDB _id update nahi hota

        const updatedDept = await Department.findOneAndUpdate(
            { _id: req.params.id, hotelId },
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedDept) return res.status(404).json({ error: 'Department not found' });

        // Emit Socket Event
        const io = req.app.get('io');
        if (io) {
            io.to(`hotel_${hotelId}`).emit('dept_upd', {
                action: 'update',
                data: updatedDept,
                syncToken: Date.now(),
                clientId: req.headers['x-client-id']
            });
        }

        res.json(updatedDept);
    } catch (err) {
        console.error('Error updating department:', err);
        res.status(500).json({ error: 'Server error updating department' });
    }
});

// ✅ DELETE: Delete a department
router.delete('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const deletedDept = await Department.findOneAndDelete({ _id: req.params.id, hotelId });

        if (!deletedDept) return res.status(404).json({ error: 'Department not found' });

        // Emit Socket Event
        const io = req.app.get('io');
        if (io) {
            io.to(`hotel_${hotelId}`).emit('dept_upd', {
                action: 'delete',
                data: { _id: req.params.id, key: deletedDept.key },
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