const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Get Current Bill
router.get('/bill', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId } = req.query;

        const bill = await db.collection('bills').findOne({
            hotel_id: hotelId,
            guest_id: guestId,
            status: 'pending'
        });

        if (!bill) {
            return res.json({
                success: true,
                bill: { total: 0, items: [], status: 'no_pending_bills' }
            });
        }

        res.json({ success: true, bill });
    } catch (error) {
        console.error('Error fetching bill:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Hotel Settings
router.get('/settings', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId } = req.query;

        const settings = await db.collection('hotel_settings').findOne({ hotel_id: hotelId });

        if (!settings) {
            return res.json({ success: false, message: 'Hotel settings not found' });
        }

        res.json({ success: true, settings });
    } catch (error) {
        console.error('Error fetching hotel settings:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
