const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Fetch all reviews
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const reviews = await db.collection('reviews').find({ hotelId }).sort({ date: -1 }).toArray();
        res.json(reviews);
    } catch (err) {
        console.error('Error fetching reviews:', err);
        res.status(500).json({ error: 'Server error fetching reviews' });
    }
});

// GET: Fetch review stats
router.get('/stats', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const reviews = await db.collection('reviews').find({ hotelId }).toArray();
        
        const total = reviews.length;
        const avgOverall = total > 0 ? (reviews.reduce((sum, r) => sum + r.overall, 0) / total).toFixed(1) : 0;
        const recommend = reviews.filter(r => r.recommend !== false).length;
        const recommendRate = total > 0 ? ((recommend / total) * 100).toFixed(0) : 0;
        
        res.json({ total, avgOverall, recommend, recommendRate });
    } catch (err) {
        console.error('Error fetching review stats:', err);
        res.status(500).json({ error: 'Server error fetching review stats' });
    }
});

// POST: Create new review
router.post('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        const { guest, room, overall, service, cleanliness, comment, recommend } = req.body;
        
        if (!guest || overall === undefined) {
            return res.status(400).json({ error: 'Guest and overall rating are required' });
        }
        
        const review = {
            hotelId,
            guest,
            room: room || null,
            overall: parseInt(overall),
            service: service !== undefined ? parseInt(service) : null,
            cleanliness: cleanliness !== undefined ? parseInt(cleanliness) : null,
            comment: comment || '',
            recommend: recommend !== false,
            date: new Date().toISOString(),
            _version: 1
        };
        
        const result = await db.collection('reviews').insertOne(review);
        review._id = result.insertedId;
        
        const io = req.app.get('io');
        if (io) io.to(`hotel_${hotelId}`).emit('review_new', { action: 'create', data: review });
        
        res.status(201).json(review);
    } catch (err) {
        console.error('Error creating review:', err);
        res.status(500).json({ error: 'Server error creating review' });
    }
});

// DELETE: Delete a review
router.delete('/:id', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const result = await db.collection('reviews').deleteOne({ _id: new ObjectId(req.params.id), hotelId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }
        
        const io = req.app.get('io');
        if (io) io.to(`hotel_${hotelId}`).emit('review_upd', { action: 'delete', data: { _id: req.params.id } });
        
        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (err) {
        console.error('Error deleting review:', err);
        res.status(500).json({ error: 'Server error deleting review' });
    }
});

module.exports = router;
