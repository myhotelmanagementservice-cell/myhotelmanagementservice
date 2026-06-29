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
        if (!CASHFREE_SECRET_KEY) {
            console.error('❌ CASHFREE_SECRET_KEY is not set');
            return false;
        }
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
// HELPER: Safe fetch wrapper (Node 18+ has native fetch)
// ============================================================
async function safeFetch(url, options) {
    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    return fetchFn(url, options);
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

        // FIX: Validate hotelId before DB query
        if (!hotelId) return error(res, 'Hotel ID not found in session', 401);

        const subscription = await db.collection('subscriptions').findOne(
            { hotelId },
            { sort: { createdAt: -1 } }
        );

        if (!subscription) return success(res, null, 'No active subscription');

        if (subscription.expiryDate && new Date(subscription.expiryDate) < new Date()) {
            subscription.status = 'expired';
        }
        if (subscription._id) subscription._id = subscription._id.toString();
        return success(res, subscription);
    } catch (err) {
        console.error('❌ Get current subscription error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// CREATE SUBSCRIPTION & CASHFREE ORDER
// ============================================================
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const hotelId = req.hotelId;

        // FIX 1: Validate hotelId
        if (!hotelId) return error(res, 'Hotel ID not found in session', 401);

        const { plan, currency, amount } = req.body;

        // FIX 2: Validate plan
        if (!plan || !SUBSCRIPTION_PLANS[plan]) {
            return error(res, 'Invalid plan. Valid plans: ' + Object.keys(SUBSCRIPTION_PLANS).join(', '), 400);
        }

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

        // FIX 3: Validate Cashfree credentials before calling API
        if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
            console.error('❌ Cashfree credentials missing: CASHFREE_APP_ID or CASHFREE_SECRET_KEY not set in .env');
            return error(res, 'Payment gateway not configured. Please contact support.', 500);
        }

        // Check if already has active subscription
        const existing = await db.collection('subscriptions').findOne({ hotelId, status: 'active' });
        if (existing) return error(res, 'Already has an active subscription', 400);

        const orderId = `hotel_${hotelId}_${Date.now()}`;
        const orderAmount = amount || planData.price;
        const orderCurrency = currency || 'INR';

        // FIX 4: Validate amount
        if (!orderAmount || isNaN(orderAmount) || orderAmount <= 0) {
            return error(res, 'Invalid payment amount', 400);
        }

        // Create pending subscription record
        const subscription = {
            hotelId, plan, planName: planData.name,
            price: orderAmount, currency: orderCurrency,
            status: 'pending', startDate: new Date(),
            paymentStatus: 'pending', paymentMethod: 'cashfree',
            transactionId: orderId,
            createdAt: new Date(), updatedAt: new Date()
        };
        const result = await db.collection('subscriptions').insertOne(subscription);
        subscription._id = result.insertedId;

        // FIX 5: Get customer email safely
        const customerEmail = req.user?.email
            || req.session?.adminEmail
            || 'admin@hotel.com';

        // Create Cashfree order payload
        const orderPayload = {
            order_id: orderId,
            order_amount: orderAmount,
            order_currency: orderCurrency,
            customer_details: {
                customer_id: String(hotelId),  // FIX 6: Ensure string
                customer_email: customerEmail,
                customer_phone: req.user?.phone || '9999999999'
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://myhotelmanagementservice.onrender.com'}/subscription-success.html?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL || 'https://myhotelmanagementservice.onrender.com'}/api/subscription/webhook`
            }
        };

        console.log('📤 Creating Cashfree order:', orderId, '| Amount:', orderAmount, orderCurrency);

        // Cashfree API call
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
            // FIX 7: Catch network-level fetch errors separately
            console.error('❌ Cashfree network error:', fetchErr.message);
            // Clean up pending subscription
            await db.collection('subscriptions').deleteOne({ _id: subscription._id });
            return error(res, 'Unable to reach payment gateway. Please try again.', 502);
        }

        // FIX 8: Safe JSON parse of Cashfree response
        let orderData;
        try {
            orderData = await cashfreeResponse.json();
        } catch (parseErr) {
            console.error('❌ Cashfree response parse error:', parseErr.message);
            await db.collection('subscriptions').deleteOne({ _id: subscription._id });
            return error(res, 'Invalid response from payment gateway', 502);
        }

        if (!cashfreeResponse.ok || !orderData.payment_session_id) {
            console.error('❌ Cashfree order creation failed:', JSON.stringify(orderData));
            // Clean up pending subscription on failure
            await db.collection('subscriptions').deleteOne({ _id: subscription._id });
            return error(res, orderData.message || orderData.error || 'Failed to create payment order', 500);
        }

        // Update subscription with Cashfree order ID
        await db.collection('subscriptions').updateOne(
            { _id: subscription._id },
            { $set: { paymentId: orderData.order_id, updatedAt: new Date() } }
        );

        console.log('✅ Cashfree order created:', orderData.order_id);

        return success(res, {
            subscription: { ...subscription, _id: subscription._id.toString() },
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
// VERIFY PAYMENT STATUS (Manual Check)
// ============================================================
router.get('/verify/:orderId', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const { orderId } = req.params;
        const hotelId = req.hotelId;

        if (!hotelId) return error(res, 'Hotel ID not found in session', 401);
        if (!orderId) return error(res, 'Order ID is required', 400);

        // FIX: Validate credentials
        if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
            return error(res, 'Payment gateway not configured', 500);
        }

        const cashfreeResponse = await safeFetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY
            }
        });

        const orderData = await cashfreeResponse.json();

        if (!cashfreeResponse.ok) {
            return error(res, orderData.message || 'Failed to verify payment', 500);
        }

        if (orderData.order_status === 'PAID') {
            const subscription = await db.collection('subscriptions').findOne({ transactionId: orderId });

            if (subscription) {
                let expiryDate = null;
                const planData = SUBSCRIPTION_PLANS[subscription.plan];
                if (planData && planData.duration) {
                    expiryDate = new Date();
                    expiryDate.setDate(expiryDate.getDate() + planData.duration);
                }

                await db.collection('subscriptions').updateOne(
                    { _id: subscription._id },
                    { $set: { paymentStatus: 'completed', status: 'active', expiryDate, updatedAt: new Date() } }
                );
                await db.collection('tenants').updateOne(
                    { hotelId },
                    { $set: { subscriptionType: subscription.plan, subscriptionExpiry: expiryDate, active: true, updatedAt: new Date() } }
                );
            }

            return success(res, { status: 'PAID', orderData, message: 'Payment successful! Subscription activated.' });

        } else if (orderData.order_status === 'FAILED') {
            await db.collection('subscriptions').updateOne(
                { transactionId: orderId },
                { $set: { paymentStatus: 'failed', updatedAt: new Date() } }
            );
            return success(res, { status: 'FAILED', orderData, message: 'Payment failed. Please try again.' });

        } else {
            return success(res, { status: orderData.order_status, orderData, message: 'Payment pending.' });
        }

    } catch (err) {
        console.error('❌ Verify payment error:', err);
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
            console.warn('⚠️ Webhook: Invalid signature received');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        let event;
        try {
            event = JSON.parse(body);
        } catch (parseErr) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }

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

        if (!hotelId) return error(res, 'Hotel ID not found in session', 401);

        const subscription = await db.collection('subscriptions').findOne(
            { hotelId },
            { sort: { createdAt: -1 } }
        );
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
        console.error('❌ Cancel subscription error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET ALL SUBSCRIPTIONS (Super Admin Only)
// ============================================================
router.get('/all', superAdminOnly, async (req, res) => {
    try {
        const db = getDB(req);
        const { status, plan } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (plan) filter.plan = plan;

        const subscriptions = await db.collection('subscriptions')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        subscriptions.forEach(s => {
            if (s._id) s._id = s._id.toString();
        });

        return success(res, subscriptions);
    } catch (err) {
        console.error('❌ Get all subscriptions error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET SUBSCRIPTION STATS (Super Admin Only)
// ============================================================
router.get('/stats', superAdminOnly, async (req, res) => {
    try {
        const db = getDB(req);

        const [byPlan, byStatus, totalResult] = await Promise.all([
            db.collection('subscriptions').aggregate([
                { $group: { _id: '$plan', count: { $sum: 1 }, revenue: { $sum: '$price' } } }
            ]).toArray(),
            db.collection('subscriptions').aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]).toArray(),
            db.collection('subscriptions').aggregate([
                { $group: { _id: null, total: { $sum: 1 }, revenue: { $sum: '$price' } } }
            ]).toArray()
        ]);

        const result = totalResult[0] || { total: 0, revenue: 0 };

        return success(res, {
            total: result.total,
            revenue: result.revenue,
            byPlan: byPlan.reduce((acc, s) => {
                acc[s._id] = { count: s.count, revenue: s.revenue };
                return acc;
            }, {}),
            byStatus: byStatus.reduce((acc, s) => {
                acc[s._id] = s.count;
                return acc;
            }, {})
        });
    } catch (err) {
        console.error('❌ Get stats error:', err);
        return error(res, err.message, 500);
    }
});

module.exports = router;