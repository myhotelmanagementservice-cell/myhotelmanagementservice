const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Fetch loyalty points for a guest
router.get('/guest/:guestId', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { guestId } = req.params;
        const db = req.app.get('db');
        
        const guest = await db.collection('guests').findOne({ _id: new ObjectId(guestId), hotelId });
        if (!guest) {
            return res.status(404).json({ error: 'Guest not found' });
        }
        
        res.json({
            success: true,
            guestId: guest._id,
            name: guest.name,
            points: guest.points || 0,
            room: guest.room,
            hotelId
        });
    } catch (err) {
        console.error('Error fetching loyalty points:', err);
        res.status(500).json({ error: 'Server error fetching loyalty points' });
    }
});

// POST: Add loyalty points
router.post('/add', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { guestId, points, reason } = req.body;
        const db = req.app.get('db');
        
        if (!guestId || !points || points <= 0) {
            return res.status(400).json({ error: 'Guest ID and positive points are required' });
        }
        
        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId },
            { $inc: { points: parseInt(points) }, $set: { updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        
        if (!result) {
            return res.status(404).json({ error: 'Guest not found' });
        }
        
        // Log the transaction
        await db.collection('loyalty_transactions').insertOne({
            hotelId,
            guestId: new ObjectId(guestId),
            guestName: result.name,
            points: parseInt(points),
            reason: reason || 'Manual addition',
            type: 'credit',
            date: new Date().toISOString()
        });
        
        const io = req.app.get('io');
        if (io) io.to(`hotel_${hotelId}`).emit('loyalty_upd', { action: 'add', data: { guestId, points: result.points } });
        
        res.json({ success: true, guestId, points: result.points });
    } catch (err) {
        console.error('Error adding loyalty points:', err);
        res.status(500).json({ error: 'Server error adding loyalty points' });
    }
});

// POST: Redeem loyalty points
router.post('/redeem', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { guestId, points, reason } = req.body;
        const db = req.app.get('db');
        
        if (!guestId || !points || points <= 0) {
            return res.status(400).json({ error: 'Guest ID and positive points are required' });
        }
        
        const guest = await db.collection('guests').findOne({ _id: new ObjectId(guestId), hotelId });
        if (!guest) {
            return res.status(404).json({ error: 'Guest not found' });
        }
        
        if ((guest.points || 0) < points) {
            return res.status(400).json({ error: 'Insufficient points' });
        }
        
        const result = await db.collection('guests').findOneAndUpdate(
            { _id: new ObjectId(guestId), hotelId },
            { $inc: { points: -parseInt(points) }, $set: { updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        
        await db.collection('loyalty_transactions').insertOne({
            hotelId,
            guestId: new ObjectId(guestId),
            guestName: result.name,
            points: parseInt(points),
            reason: reason || 'Redeemed',
            type: 'debit',
            date: new Date().toISOString()
        });
        
        const io = req.app.get('io');
        if (io) io.to(`hotel_${hotelId}`).emit('loyalty_upd', { action: 'redeem', data: { guestId, points: result.points } });
        
        res.json({ success: true, guestId, points: result.points });
    } catch (err) {
        console.error('Error redeeming loyalty points:', err);
        res.status(500).json({ error: 'Server error redeeming loyalty points' });
    }
});

// GET: Loyalty transactions for a guest
router.get('/transactions/:guestId', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const { guestId } = req.params;
        const db = req.app.get('db');
        
        const transactions = await db.collection('loyalty_transactions')
            .find({ hotelId, guestId: new ObjectId(guestId) })
            .sort({ date: -1 })
            .toArray();
        
        res.json({ success: true, data: transactions });
    } catch (err) {
        console.error('Error fetching loyalty transactions:', err);
        res.status(500).json({ error: 'Server error fetching transactions' });
    }
});

module.exports = router;
