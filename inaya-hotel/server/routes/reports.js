const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Generate report
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { type, from, to } = req.query;
        const db = req.app.get('db');
        
        let data = [];
        let report = { type, from, to, generatedAt: new Date().toISOString() };
        
        switch(type) {
            case 'bookings':
                data = await db.collection('bookings').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                report.data = data;
                report.total = data.length;
                report.revenue = data.reduce((sum, b) => sum + (b.totalPriceSAR || 0), 0);
                break;
            case 'requests':
                data = await db.collection('requests').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                report.data = data;
                report.total = data.length;
                report.open = data.filter(r => r.status === 'open').length;
                report.completed = data.filter(r => r.status === 'completed').length;
                break;
            case 'guests':
                data = await db.collection('guests').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                report.data = data;
                report.total = data.length;
                break;
            case 'rooms':
                data = await db.collection('rooms').find({ hotelId }).toArray();
                report.data = data;
                report.total = data.length;
                report.occupied = data.filter(r => r.status === 'Occupied').length;
                report.vacant = data.filter(r => r.status === 'Vacant').length;
                break;
            case 'revenue':
                const bookings = await db.collection('bookings').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                report.data = bookings;
                report.totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPriceSAR || 0), 0);
                report.totalBookings = bookings.length;
                break;
            default:
                return res.status(400).json({ error: 'Invalid report type' });
        }
        
        res.json(report);
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ error: 'Server error generating report' });
    }
});

// POST: Export report
router.post('/export', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { type, from, to } = req.body;
        const db = req.app.get('db');
        
        let data = [];
        switch(type) {
            case 'bookings':
                data = await db.collection('bookings').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                break;
            case 'requests':
                data = await db.collection('requests').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                break;
            case 'guests':
                data = await db.collection('guests').find({ 
                    hotelId,
                    createdAt: { $gte: new Date(from), $lte: new Date(to) }
                }).toArray();
                break;
            default:
                return res.status(400).json({ error: 'Invalid export type' });
        }
        
        res.json({ data, count: data.length, type, generatedAt: new Date().toISOString() });
    } catch (err) {
        console.error('Error exporting report:', err);
        res.status(500).json({ error: 'Server error exporting report' });
    }
});

module.exports = router;
