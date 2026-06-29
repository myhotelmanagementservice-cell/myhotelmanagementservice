// server/routes/subscription.js
// Subscription API Routes with Cashfree Bearer Token Authentication (FIXED)

const express = require('express');
const router = express.Router();
const { authMiddleware, superAdminOnly } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');
const cashfree = require('../utils/cashfree');

const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox';

// ============================================================
// SUBSCRIPTION PLANS (Inline Definition)
// ============================================================
const SUBSCRIPTION_PLANS = {
    free: {
        name: 'Free Trial',
        price: 0,
        duration: 7,
        features: ['Up to 10 rooms', 'Up to 50 guests', 'Basic support', 'Core features']
    },
    basic: {
        name: 'Basic',
        price: 29,
        duration: 30,
        features: ['Up to 50 rooms', 'Up to 500 guests', 'Email support', 'All core features', 'Basic reporting']
    },
    pro: {
        name: 'Professional',
        price: 99,
        duration: 30,
        features: ['Up to 200 rooms', 'Unlimited guests', 'Priority support', 'All features', 'Advanced reporting', 'API access']
    },
    enterprise: {
        name: 'Enterprise',
        price: 499,
        duration: 365,
        features: ['Unlimited rooms', 'Unlimited guests', '24/7 support', 'All features', 'Advanced analytics', 'API access', 'Custom integrations', 'Dedicated manager']
    },
    lifetime: {
        name: 'Lifetime',
        price: 2999,
        duration: null,
        features: ['Unlimited everything', 'Lifetime access', '24/7 priority support', 'All features', 'Custom branding', 'Priority updates']
    }
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
// GET AVAILABLE PLANS
// ============================================================
router.get('/plans', (req, res) => {
    try {
        const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
            id: key,
            ...plan
        }));
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

        const subscription = await db.collection('subscriptions')
            .findOne({ hotelId }, { sort: { createdAt: -1 } });

        if (!subscription) {
            return success(res, null, 'No active subscription');
        }

        // Check if expired
        if (subscription.expiryDate && new Date(subscription.expiryDate) < new Date()) {
            subscription.status = 'expired';
        }

        if (subscription._id) subscription._id = subscription._id.toString();
        return success(res, subscription);
    } catch (err) {
        console.error('❌ Get current subscription error:', err.message);
        return error(res, err.message, 500);
    }
});

// ============================================================
// CREATE SUBSCRIPTION & CASHFREE ORDER (WITH BEARER TOKEN)
// ============================================================
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const hotelId = req.hotelId;
        const { plan, currency, amount, customerEmail, customerPhone } = req.body;

        if (!plan) {
            return error(res, 'Plan is required', 400);
        }

        const planData = SUBSCRIPTION_PLANS[plan];
        if (!planData) {
            return error(res, 'Invalid plan', 400);
        }

        // Calculate expiry date
        let expiryDate = null;
        if (planData.duration) {
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + planData.duration);
        }

        // Free plan - direct activation
        if (planData.price === 0) {
            const subscription = {
                hotelId,
                plan,
                planName: planData.name,
                price: 0,
                currency: 'USD',
                status: 'active',
                startDate: new Date(),
                expiryDate: expiryDate,
                paymentStatus: 'completed',
                paymentMethod: 'free',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await db.collection('subscriptions').insertOne(subscription);

            // Update tenant
            await db.collection('tenants').updateOne(
                { hotelId },
                {
                    $set: {
                        subscriptionType: plan,
                        subscriptionExpiry: expiryDate,
                        active: true,
                        updatedAt: new Date()
                    }
                }
            );

            return success(res, {
                subscription,
                message: 'Free trial activated successfully'
            });
        }

        // Check if already has active subscription
        const existing = await db.collection('subscriptions')
            .findOne({ hotelId, status: 'active' });

        if (existing) {
            return error(res, 'Already has active subscription', 400);
        }

        // Generate unique order ID
        const orderId = `hotel_${hotelId}_${Date.now()}`;

        // Create subscription record (pending)
        const subscription = {
            hotelId,
            plan,
            planName: planData.name,
            price: amount || planData.price,
            currency: currency || 'USD',
            status: 'pending',
            startDate: new Date(),
            paymentStatus: 'pending',
            paymentMethod: 'cashfree',
            transactionId: orderId,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await db.collection('subscriptions').insertOne(subscription);

        // Create Cashfree order payload
        const orderPayload = {
            order_id: orderId,
            order_amount: amount || planData.price,
            order_currency: currency || 'INR',
            customer_details: {
                customer_id: hotelId,
                customer_email: customerEmail || req.user.email || 'admin@hotel.com',
                customer_phone: customerPhone || '9999999999'
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://myhotelmanagementservice.onrender.com'}/subscription-success.html?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL || 'https://myhotelmanagementservice.onrender.com'}/api/subscription/webhook`
            },
            order_note: `Subscription for ${planData.name} plan`
        };

        // ✅ Call Cashfree API with Bearer Token
        const orderData = await cashfree.createOrder(orderPayload);

        if (!orderData.order_id) {
            console.error('❌ Cashfree order creation failed:', orderData);
            return error(res, orderData.message || 'Failed to create payment order', 500);
        }

        console.log('✅ Cashfree order created:', orderData.order_id);

        // Update subscription with order ID
        await db.collection('subscriptions').updateOne(
            { _id: subscription._id },
            {
                $set: {
                    paymentId: orderData.order_id,
                    transactionId: orderId,
                    updatedAt: new Date()
                }
            }
        );

        // Return payment session details
        return success(res, {
            subscription,
            paymentSession: {
                orderId: orderData.order_id,
                paymentSessionId: orderData.payment_session_id,
                orderAmount: orderData.order_amount,
                orderCurrency: orderData.order_currency,
                environment: CASHFREE_ENVIRONMENT
            },
            message: 'Payment order created. Redirect to payment gateway.'
        });

    } catch (err) {
        console.error('❌ Create subscription error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// VERIFY PAYMENT STATUS (WITH BEARER TOKEN)
// ============================================================
router.get('/verify/:orderId', authMiddleware, async (req, res) => {
    try {
        const db = getDB(req);
        const { orderId } = req.params;
        const hotelId = req.hotelId;

        // ✅ Call Cashfree API with Bearer Token
        const orderData = await cashfree.getOrderStatus(orderId);

        if (!orderData.order_id) {
            return error(res, orderData.message || 'Failed to verify payment', 500);
        }

        // Update subscription based on payment status
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
                    {
                        $set: {
                            paymentStatus: 'completed',
                            status: 'active',
                            expiryDate: expiryDate,
                            updatedAt: new Date()
                        }
                    }
                );

                // Update tenant
                await db.collection('tenants').updateOne(
                    { hotelId },
                    {
                        $set: {
                            subscriptionType: subscription.plan,
                            subscriptionExpiry: expiryDate,
                            active: true,
                            updatedAt: new Date()
                        }
                    }
                );
            }

            return success(res, {
                status: 'PAID',
                orderData,
                message: 'Payment successful! Subscription activated.'
            });
        } else if (orderData.order_status === 'FAILED') {
            await db.collection('subscriptions').updateOne(
                { transactionId: orderId },
                { $set: { paymentStatus: 'failed', updatedAt: new Date() } }
            );

            return success(res, {
                status: 'FAILED',
                orderData,
                message: 'Payment failed. Please try again.'
            });
        } else {
            return success(res, {
                status: orderData.order_status,
                orderData,
                message: 'Payment pending.'
            });
        }

    } catch (err) {
        console.error('❌ Verify payment error:', err);
        return error(res, err.message, 500);
    }
});

// ============================================================
// CASHFREE WEBHOOK (WITH SIGNATURE VERIFICATION)
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) {
            console.error('❌ Database not connected in webhook');
            return res.status(503).json({ error: 'Database not connected' });
        }

        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const body = req.body.toString('utf8');

        console.log('📥 Webhook received at:', new Date().toISOString());
        console.log('📋 Signature:', signature?.substring(0, 20) + '...');
        console.log('📋 Timestamp:', timestamp);

        // ✅ Verify webhook signature (uses same secret key)
        if (!cashfree.verifyWebhookSignature(signature, timestamp, body)) {
            console.error('❌ Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        console.log('✅ Webhook signature verified');

        const event = JSON.parse(body);
        console.log('📥 Cashfree webhook event:', event.type);

        // Handle different payment events
        switch (event.type) {
            case 'PAYMENT_SUCCESS_WEBHOOK':
            case 'ORDER_PAID': {
                const orderId = event.data?.order?.order_id;
                const hotelId = event.data?.order?.customer_details?.customer_id;

                if (!orderId || !hotelId) {
                    console.error('❌ Missing orderId or hotelId in webhook');
                    break;
                }

                console.log(`✅ Payment successful for order: ${orderId}, hotel: ${hotelId}`);

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
                        {
                            $set: {
                                paymentStatus: 'completed',
                                status: 'active',
                                transactionId: orderId,
                                paymentId: orderId,
                                expiryDate: expiryDate,
                                updatedAt: new Date()
                            }
                        }
                    );

                    // Update tenant
                    await db.collection('tenants').updateOne(
                        { hotelId },
                        {
                            $set: {
                                subscriptionType: subscription.plan,
                                subscriptionExpiry: expiryDate,
                                active: true,
                                updatedAt: new Date()
                            }
                        }
                    );

                    console.log(`✅ Subscription activated for hotel: ${hotelId}`);
                }
                break;
            }

            case 'PAYMENT_FAILED_WEBHOOK':
            case 'ORDER_FAILED': {
                const failedOrderId = event.data?.order?.order_id;
                const failedHotelId = event.data?.order?.customer_details?.customer_id;

                if (!failedOrderId || !failedHotelId) {
                    console.error('❌ Missing orderId or hotelId in failed webhook');
                    break;
                }

                console.log(`❌ Payment failed for order: ${failedOrderId}, hotel: ${failedHotelId}`);

                await db.collection('subscriptions').updateOne(
                    { transactionId: failedOrderId },
                    { $set: { paymentStatus: 'failed', updatedAt: new Date() } }
                );
                break;
            }

            default:
                console.log('⚠️ Unhandled webhook event:', event.type);
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

        const subscription = await db.collection('subscriptions')
            .findOne({ hotelId }, { sort: { createdAt: -1 } });

        if (!subscription) {
            return error(res, 'No subscription found', 404);
        }

        await db.collection('subscriptions').updateOne(
            { _id: subscription._id },
            {
                $set: {
                    status: 'cancelled',
                    autoRenew: false,
                    updatedAt: new Date()
                }
            }
        );

        // Update tenant
        await db.collection('tenants').updateOne(
            { hotelId },
            {
                $set: {
                    subscriptionType: 'free',
                    active: false,
                    updatedAt: new Date()
                }
            }
        );

        return success(res, null, 'Subscription cancelled');

    } catch (err) {
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET ALL SUBSCRIPTIONS (Super Admin)
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
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET SUBSCRIPTION STATS (Super Admin)
// ============================================================
router.get('/stats', superAdminOnly, async (req, res) => {
    try {
        const db = getDB(req);

        const byPlan = await db.collection('subscriptions').aggregate([
            { $group: { _id: '$plan', count: { $sum: 1 }, revenue: { $sum: '$price' } } }
        ]).toArray();

        const byStatus = await db.collection('subscriptions').aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const totalResult = await db.collection('subscriptions').aggregate([
            { $group: { _id: null, total: { $sum: 1 }, revenue: { $sum: '$price' } } }
        ]).toArray();

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
        return error(res, err.message, 500);
    }
});

module.exports = router;