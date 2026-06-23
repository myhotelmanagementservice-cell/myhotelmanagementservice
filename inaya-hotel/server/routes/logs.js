const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Fetch logs with filters
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { user, action, from, to, limit = 50 } = req.query;
        const db = req.app.get('db');
        
        let filter = { hotelId };
        if (user) filter.user = user;
        if (action) filter.action = { $regex: action, $options: 'i' };
        if (from && to) {
            filter.timestamp = { $gte: new Date(from).toISOString(), $lte: new Date(to).toISOString() };
        }
        
        const logs = await db.collection('logs')
            .find(filter)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .toArray();
        
        res.json(logs);
    } catch (err) {
        console.error('Error fetching logs:', err);
        res.status(500).json({ error: 'Server error fetching logs' });
    }
});

// POST: Create a new log
router.post('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { user, action, details } = req.body;
        const db = req.app.get('db');
        
        if (!action) {
            return res.status(400).json({ error: 'Action is required' });
        }
        
        const log = {
            hotelId,
            timestamp: new Date().toISOString(),
            user: user || 'System',
            action: action,
            details: details || '',
            _version: 1
        };
        
        const result = await db.collection('logs').insertOne(log);
        log._id = result.insertedId;
        
        res.status(201).json({ success: true, data: log });
    } catch (err) {
        console.error('Error creating log:', err);
        res.status(500).json({ error: 'Server error creating log' });
    }
});

// DELETE: Clear all logs for a hotel
router.delete('/clear', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        await db.collection('logs').deleteMany({ hotelId });
        
        res.json({ success: true, message: 'All logs cleared successfully' });
    } catch (err) {
        console.error('Error clearing logs:', err);
        res.status(500).json({ error: 'Server error clearing logs' });
    }
});

// DELETE: Delete a specific log
router.delete('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const result = await db.collection('logs').deleteOne({ _id: new ObjectId(req.params.id), hotelId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Log not found' });
        }
        
        res.json({ success: true, message: 'Log deleted successfully' });
    } catch (err) {
        console.error('Error deleting log:', err);
        res.status(500).json({ error: 'Server error deleting log' });
    }
});

module.exports = router;
