const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Guest full history (requests + bookings + cab)
router.get('/:guestName', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guestName } = req.params;
        
        const [requests, bookings, cabBookings] = await Promise.all([
            db.collection('requests').find({ hotelId, guestName }).sort({ createdAt: -1 }).toArray(),
            db.collection('bookings').find({ hotelId, guestName }).sort({ createdAt: -1 }).toArray(),
            db.collection('cab_bookings').find({ hotelId, guestName }).sort({ createdAt: -1 }).toArray()
        ]);
        
        const history = {
            guestName,
            requests: requests.map(r => ({
                ...r,
                type: 'request',
                date: r.createdAt || r.date
            })),
            bookings: bookings.map(b => ({
                ...b,
                type: 'booking',
                date: b.createdAt || b.date
            })),
            cabBookings: cabBookings.map(c => ({
                ...c,
                type: 'cab',
                date: c.createdAt || c.date
            })),
            total: requests.length + bookings.length + cabBookings.length
        };
        
        res.json(history);
    } catch (err) {
        console.error('Error fetching guest history:', err);
        res.status(500).json({ error: 'Server error fetching guest history' });
    }
});

// GET: Guest request history only
router.get('/requests/:guestName', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guestName } = req.params;
        
        const requests = await db.collection('requests')
            .find({ hotelId, guestName })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json(requests);
    } catch (err) {
        console.error('Error fetching request history:', err);
        res.status(500).json({ error: 'Server error fetching request history' });
    }
});

// GET: Guest booking history only
router.get('/bookings/:guestName', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guestName } = req.params;
        
        const bookings = await db.collection('bookings')
            .find({ hotelId, guestName })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching booking history:', err);
        res.status(500).json({ error: 'Server error fetching booking history' });
    }
});

module.exports = router;
