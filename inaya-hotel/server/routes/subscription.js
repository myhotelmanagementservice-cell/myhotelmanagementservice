// server/routes/subscription.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { success, error } = require('../utils/apiResponse');
const { authMiddleware, superAdminOnly } = require('../middleware/auth');

// ============================================================
// CASHFREE CONFIGURATION
// ============================================================
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox';

const CASHFREE_BASE_URL = CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ============================================================
// SUBSCRIPTION PLANS
// ============================================================
const SUBSCRIPTION_PLANS = {
    free: { name: 'Free Trial', price: 0, duration: 7, features: ['Up to 10 rooms', 'Up to 50 guests', 'Basic support'] },
    basic: { name: 'Basic', price: 29, duration: 30, features: ['Up to 50 rooms', 'Up to 500 guests', 'Email support'] },
    pro: { name: 'Professional', price: 99, duration: 30, features: ['Up to 200 rooms', 'Unlimited guests', 'Priority support'] },
    enterprise: { name: 'Enterprise', price: 499, duration: 365, features: ['Unlimited rooms', 'Unlimited guests', '24/7 support'] },
    lifetime: { name: 'Lifetime', price: 2999, duration: null, features: ['Unlimited everything', 'Lifetime access'] }
};

// ============================================================
// HELPER: Get DB safely from Express app
// ============================================================
function getDB(req) {
    const db = req.app.get('db');
    if (!db) throw new Error('Database not connected');
    return db;
}

// ============================================================
// HELPER: Verify Cashfree Webhook Signature
// ============================================================
function verifyWebhookSignature(signature, timestamp, body) {
    try {
        if (!signature || !timestamp || !body) return false;
        const payload = timestamp + body;
        const generatedSignature = crypto
            .createHmac('sha256', CASHFREE_SECRET_KEY)
            .update(payload)
            .digest('base64');
        return signature === generatedSignature;
    } catch (err) {
        console.error('❌ Webhook signature error:', err.message);
        return false;
    }
}

// ============================================================
// GET AVAILABLE PLANS
// ============================================================
router.get('/plans', (req, res) => {
    try {
        const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({ id: key, ...plan }));
        return success(res, plans);
    } catch (err) {
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET CURRENT SUBSCRIPTION
// ============================================================
router.get('/current', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const hotelId = req.hotelId;
        const subscription = await db.collection('subscriptions').findOne({ hotelId }, { sort: { createdAt: -1 } });

        if (!subscription) return success(res, null, 'No active subscription');

        if (subscription.expiryDate && new Date(subscription.expiryDate) < new Date()) {
            subscription.status = 'expired';
        }
        if (subscription._id) subscription._id = subscription._id.toString();
        return success(res, subscription);
    } catch (err) {
        return error(res, err.message, 500);
    }
});

// ============================================================
// CREATE SUBSCRIPTION & CASHFREE ORDER (FIXED: Direct API Call)
// ============================================================
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const hotelId = req.hotelId;
        const { plan, currency, amount } = req.body;

        if (!plan || !SUBSCRIPTION_PLANS[plan]) return error(res, 'Invalid plan', 400);
        const planData = SUBSCRIPTION_PLANS[plan];

        // Calculate expiry date
        let expiryDate = null;
        if (planData.duration) {
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + planData.duration);
        }

        // Free plan - direct activation
        if (planData.price === 0) {
            const subscription = {
                hotelId, plan, planName: planData.name, price: 0, currency: 'USD',
                status: 'active', startDate: new Date(), expiryDate,
                paymentStatus: 'completed', paymentMethod: 'free',
                createdAt: new Date(), updatedAt: new Date()
            };
            await db.collection('subscriptions').insertOne(subscription);
            await db.collection('tenants').updateOne(
                { hotelId },
                { $set: { subscriptionType: plan, subscriptionExpiry: expiryDate, active: true, updatedAt: new Date() } }
            );
            return success(res, { subscription }, 'Free trial activated successfully');
        }

        // Check if already has active subscription
        const existing = await db.collection('subscriptions').findOne({ hotelId, status: 'active' });
        if (existing) return error(res, 'Already has active subscription', 400);

        const orderId = `hotel_${hotelId}_${Date.now()}`;

        // Create pending subscription record
        const subscription = {
            hotelId, plan, planName: planData.name, price: amount || planData.price,
            currency: currency || 'USD', status: 'pending', startDate: new Date(),
            paymentStatus: 'pending', paymentMethod: 'cashfree', transactionId: orderId,
            createdAt: new Date(), updatedAt: new Date()
        };
        const result = await db.collection('subscriptions').insertOne(subscription);
        subscription._id = result.insertedId;

        // Create Cashfree order payload
        const orderPayload = {
            order_id: orderId,
            order_amount: amount || planData.price,
            order_currency: currency || 'INR',
            customer_details: {
                customer_id: hotelId,
                customer_email: req.user.email || 'admin@hotel.com',
                customer_phone: '9999999999'
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://myhotelmanagementservice.onrender.com'}/subscription-success.html?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL || 'https://myhotelmanagementservice.onrender.com'}/api/subscription/webhook`
            }
        };

        // ✅ CORRECT CASHFREE API CALL (No Bearer Token, No Signature needed for Orders)
        const cashfreeResponse = await fetch(`${CASHFREE_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY
            },
            body: JSON.stringify(orderPayload)
        });

        const orderData = await cashfreeResponse.json();

        if (!cashfreeResponse.ok || !orderData.payment_session_id) {
            console.error('❌ Cashfree error:', orderData);
            return error(res, orderData.message || 'Failed to create payment order', 500);
        }

        // Update subscription with Cashfree order ID
        await db.collection('subscriptions').updateOne(
            { _id: subscription._id },
            { $set: { paymentId: orderData.order_id, updatedAt: new Date() } }
        );

        return success(res, {
            subscription,
            paymentSession: {
                orderId: orderData.order_id,
                paymentSessionId: orderData.payment_session_id,
                environment: CASHFREE_ENVIRONMENT
            }
        }, 'Payment order created');

    } catch (err) {
        console.error('❌ Create subscription error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// CASHFREE WEBHOOK
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) return res.status(503).json({ error: 'Database not connected' });

        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const body = req.body.toString('utf8');

        if (!verifyWebhookSignature(signature, timestamp, body)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const event = JSON.parse(body);
        console.log('📥 Cashfree webhook event:', event.type);

        if (event.type === 'PAYMENT_SUCCESS_WEBHOOK' || event.type === 'ORDER_PAID') {
            const orderId = event.data?.order?.order_id;
            const hotelId = event.data?.order?.customer_details?.customer_id;

            if (orderId && hotelId) {
                const sub = await db.collection('subscriptions').findOne({ transactionId: orderId });
                if (sub) {
                    let expiryDate = null;
                    const planData = SUBSCRIPTION_PLANS[sub.plan];
                    if (planData && planData.duration) {
                        expiryDate = new Date();
                        expiryDate.setDate(expiryDate.getDate() + planData.duration);
                    }

                    await db.collection('subscriptions').updateOne(
                        { _id: sub._id },
                        { $set: { paymentStatus: 'completed', status: 'active', expiryDate, updatedAt: new Date() } }
                    );
                    await db.collection('tenants').updateOne(
                        { hotelId },
                        { $set: { subscriptionType: sub.plan, subscriptionExpiry: expiryDate, active: true, updatedAt: new Date() } }
                    );
                    console.log(`✅ Subscription activated for hotel: ${hotelId}`);
                }
            }
        }
        res.json({ status: 'ok' });
    } catch (err) {
        console.error('❌ Webhook error:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// CANCEL SUBSCRIPTION
// ============================================================
router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const hotelId = req.hotelId;
        const subscription = await db.collection('subscriptions').findOne({ hotelId }, { sort: { createdAt: -1 } });
        if (!subscription) return error(res, 'No subscription found', 404);

        await db.collection('subscriptions').updateOne(
            { _id: subscription._id },
            { $set: { status: 'cancelled', autoRenew: false, updatedAt: new Date() } }
        );
        await db.collection('tenants').updateOne(
            { hotelId },
            { $set: { subscriptionType: 'free', active: false, updatedAt: new Date() } }
        );
        return success(res, null, 'Subscription cancelled');
    } catch (err) {
        return error(res, err.message, 500);
    }
});

module.exports = router;
