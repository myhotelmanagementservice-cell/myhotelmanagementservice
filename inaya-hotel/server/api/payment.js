const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const crypto = require('crypto');

// ============================================================
// CASHFREE CONFIGURATION (Guest Bill Payments)
// ============================================================
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox';
const CASHFREE_BASE_URL = CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

async function safeFetch(url, options) {
    return fetch(url, options);
}

// Get UPI Details
router.get('/upi-details', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId } = req.query;
        const settings = await db.collection('hotel_settings').findOne({ hotel_id: hotelId });
        if (!settings || !settings.upiId) {
            return res.json({ success: false, message: 'UPI not configured' });
        }
        res.json({
            success: true,
            upiId: settings.upiId,
            qrCode: settings.qrCodeUrl
        });
    } catch (error) {
        console.error('Error fetching UPI details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get PayPal Email (Per-Hotel)
router.get('/paypal-details', async (req, res) => {
    try {
        const db = getDB();
        const { hotelId } = req.query;
        const settings = await db.collection('hotel_settings').findOne({ hotel_id: hotelId });
        if (!settings || !settings.paypalEmail) {
            return res.json({ success: false, message: 'PayPal not configured' });
        }
        res.json({
            success: true,
            paypalEmail: settings.paypalEmail
        });
    } catch (error) {
        console.error('Error fetching PayPal details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Record Payment
router.post('/record', async (req, res) => {
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
router.get('/history', async (req, res) => {
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

// ============================================================
// CREATE CASHFREE ORDER (Guest Bill Payment — Card/GPay/Apple Pay)
// ============================================================
router.post('/create-order', async (req, res) => {
    try {
        if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
            console.error('❌ Cashfree credentials missing for guest payment');
            return res.status(500).json({ success: false, message: 'Payment gateway not configured. Please contact support.' });
        }
        const db = getDB();
        const { hotelId, guestId, amount, guestName, guestPhone, guestEmail } = req.body;

        if (!hotelId || !guestId) {
            return res.status(400).json({ success: false, message: 'hotelId and guestId are required' });
        }
        const orderAmount = parseFloat(amount);
        if (!orderAmount || isNaN(orderAmount) || orderAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid payment amount' });
        }

        const orderId = `bill_${hotelId}_${guestId}_${Date.now()}`;

        const paymentRecord = {
            hotel_id: hotelId,
            guest_id: guestId,
            amount: orderAmount,
            payment_method: 'cashfree',
            transaction_id: orderId,
            status: 'pending',
            currency: 'INR',
            created_at: new Date()
        };
        const insertResult = await db.collection('payments').insertOne(paymentRecord);

        const orderPayload = {
            order_id: orderId,
            order_amount: orderAmount,
            order_currency: 'INR',
            customer_details: {
                customer_id: String(guestId),
                customer_name: guestName || 'Guest',
                customer_email: guestEmail || 'guest@hotel.com',
                customer_phone: guestPhone || '9999999999'
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://myhotelmanagementservice.com'}/guest-hub.html?hotelId=${hotelId}&guestId=${guestId}&paymentOrderId=${orderId}`
            }
        };

        let cashfreeResponse;
        try {
            cashfreeResponse = await safeFetch(`${CASHFREE_BASE_URL}/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-version': '2023-08-01',
                    'x-client-id': CASHFREE_APP_ID,
                    'x-client-secret': CASHFREE_SECRET_KEY
                },
                body: JSON.stringify(orderPayload)
            });
        } catch (fetchErr) {
            console.error('❌ Cashfree network error:', fetchErr.message);
            await db.collection('payments').deleteOne({ _id: insertResult.insertedId });
            return res.status(502).json({ success: false, message: 'Unable to reach payment gateway. Please try again.' });
        }

        let orderData;
        try {
            orderData = await cashfreeResponse.json();
        } catch (parseErr) {
            console.error('❌ Cashfree response parse error:', parseErr.message);
            await db.collection('payments').deleteOne({ _id: insertResult.insertedId });
            return res.status(502).json({ success: false, message: 'Invalid response from payment gateway' });
        }

        if (!cashfreeResponse.ok || !orderData.payment_session_id) {
            console.error('❌ Cashfree order creation failed:', JSON.stringify(orderData));
            await db.collection('payments').deleteOne({ _id: insertResult.insertedId });
            return res.status(500).json({ success: false, message: orderData.message || 'Failed to create payment order' });
        }

        res.json({
            success: true,
            orderId,
            paymentSessionId: orderData.payment_session_id
        });
    } catch (error) {
        console.error('Error creating guest payment order:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================================
// VERIFY CASHFREE ORDER STATUS (Guest Bill Payment)
// ============================================================
router.get('/verify-order/:orderId', async (req, res) => {
    try {
        if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
            return res.status(500).json({ success: false, message: 'Payment gateway not configured' });
        }
        const db = getDB();
        const { orderId } = req.params;

        const cashfreeResponse = await safeFetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
            headers: {
                'x-api-version': '2023-08-01',
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY
            }
        });
        const orderData = await cashfreeResponse.json();

        if (orderData.order_status === 'PAID') {
            const payment = await db.collection('payments').findOne({ transaction_id: orderId });
            if (payment && payment.status !== 'completed') {
                await db.collection('payments').updateOne(
                    { transaction_id: orderId },
                    { $set: { status: 'completed', updated_at: new Date() } }
                );
                await db.collection('bills').updateOne(
                    { hotel_id: payment.hotel_id, guest_id: payment.guest_id, status: 'pending' },
                    { $set: { status: 'paid', updated_at: new Date() } }
                );
            }
            return res.json({ success: true, status: 'PAID' });
        }

        res.json({ success: true, status: orderData.order_status || 'PENDING' });
    } catch (error) {
        console.error('Error verifying guest payment order:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
