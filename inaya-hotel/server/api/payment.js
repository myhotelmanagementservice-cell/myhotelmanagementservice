const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Get UPI Details
router.get('/upi-details', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId } = req.query;

        const paymentSettings = await db.collection('hotel_payment_settings').findOne({
            hotel_id: hotelId,
            payment_method: 'upi'
        });

        if (!paymentSettings) {
            return res.json({ success: false, message: 'UPI not configured' });
        }

        res.json({
            success: true,
            upiId: paymentSettings.upi_id,
            qrCode: paymentSettings.upi_qr_code
        });
    } catch (error) {
        console.error('Error fetching UPI details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Record Payment
router.post('/record', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId, amount, method, transactionId, status } = req.body;

        const paymentRecord = {
            hotel_id: hotelId,
            guest_id: guestId,
            amount: parseFloat(amount),
            payment_method: method,
            transaction_id: transactionId,
            status: status || 'completed',
            currency: 'INR',
            created_at: new Date()
        };

        const result = await db.collection('payments').insertOne(paymentRecord);

        // Update bill status to paid
        await db.collection('bills').updateOne(
            { hotel_id: hotelId, guest_id: guestId, status: 'pending' },
            { $set: { status: 'paid', updated_at: new Date() } }
        );

        res.json({ success: true, message: 'Payment recorded successfully', paymentId: result.insertedId });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Payment History
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId } = req.query;

        const payments = await db.collection('payments')
            .find({ hotel_id: hotelId, guest_id: guestId })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        res.json({ success: true, payments });
    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
