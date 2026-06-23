const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Cab prices
router.get('/prices', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const config = await db.collection('config').findOne({ hotelId });
        const prices = {
            airport: config?.airportPrice || 115,
            local: config?.localPrice || 60,
            currency: config?.currency || 'SAR'
        };
        
        res.json(prices);
    } catch (err) {
        console.error('Error fetching cab prices:', err);
        res.status(500).json({ error: 'Server error fetching cab prices' });
    }
});

// POST: Book a cab
router.post('/book', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guestName, roomNumber, type, pickupTime, notes } = req.body;
        
        if (!guestName || !roomNumber || !type) {
            return res.status(400).json({ error: 'Guest name, room number, and type are required' });
        }
        
        const booking = {
            hotelId,
            guestName,
            roomNumber: parseInt(roomNumber),
            type: type, // 'airport' or 'local'
            pickupTime: pickupTime || new Date().toISOString(),
            notes: notes || '',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _version: 1
        };
        
        const result = await db.collection('cab_bookings').insertOne(booking);
        booking._id = result.insertedId;
        
        const io = req.app.get('io');
        if (io) {
            io.to(`hotel_${hotelId}`).emit('cab_booking', { action: 'create', data: booking });
        }
        
        res.status(201).json({ success: true, data: booking });
    } catch (err) {
        console.error('Error booking cab:', err);
        res.status(500).json({ error: 'Server error booking cab' });
    }
});

// GET: Guest cab history
router.get('/history/:guestName', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guestName } = req.params;
        
        const bookings = await db.collection('cab_bookings')
            .find({ hotelId, guestName })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching cab history:', err);
        res.status(500).json({ error: 'Server error fetching cab history' });
    }
});

module.exports = router;
