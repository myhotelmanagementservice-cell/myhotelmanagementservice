// server/routes/subscription.js
// Subscription API Routes with Cashfree Integration

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Subscription = require('../models/Subscription');
const { getDB } = require('../config/db');
const { authMiddleware, superAdminOnly } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

// ============================================================
// CASHFREE CONFIGURATION
// ============================================================
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox';
const CASHFREE_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET;

const CASHFREE_BASE_URL = CASHFREE_ENVIRONMENT === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ============================================================
// HELPER: Generate Cashfree Signature
// ============================================================
function generateCashfreeSignature(payload) {
    const message = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', CASHFREE_SECRET_KEY)
        .update(message)
        .digest('hex');
    return signature;
}

// ============================================================
// HELPER: Verify Cashfree Webhook Signature
// ============================================================
function verifyWebhookSignature(signature, timestamp, body) {
    const generatedSignature = crypto
        .createHmac('sha256', CASHFREE_WEBHOOK_SECRET)
        .update(timestamp + body)
        .digest('hex');
    
    return signature === generatedSignature;
}

// ============================================================
// GET AVAILABLE PLANS
// ============================================================
router.get('/plans', (req, res) => {
    try {
        const plans = Object.entries(Subscription.SUBSCRIPTION_PLANS).map(([key, plan]) => ({
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
        const hotelId = req.hotelId;
        const subscription = await Subscription.getSubscription(hotelId);

        if (!subscription) {
            return success(res, null, 'No active subscription');
        }

        return success(res, subscription);
    } catch (err) {
        return error(res, err.message, 500);
    }
});

// ============================================================
// CREATE SUBSCRIPTION & CASHFREE ORDER
// ============================================================
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const hotelId = req.hotelId;
        const { plan, customerEmail, customerPhone } = req.body;

        if (!plan) {
            return error(res, 'Plan is required', 400);
        }

        const planData = Subscription.SUBSCRIPTION_PLANS[plan];
        if (!planData) {
            return error(res, 'Invalid plan', 400);
        }

        // Free plan - direct activation
        if (planData.price === 0) {
            const subscription = await Subscription.createSubscription(hotelId, {
                plan,
                paymentMethod: 'free',
                paymentStatus: 'completed'
            });

            return success(res, {
                subscription,
                message: 'Free trial activated successfully'
            });
        }

        // Check if already has active subscription
        const existing = await Subscription.getSubscription(hotelId);
        if (existing && existing.status === 'active') {
            return error(res, 'Already has active subscription', 400);
        }

        // Generate unique order ID
        const orderId = `hotel_${hotelId}_${Date.now()}`;

        // Create subscription record (pending)
        const subscription = await Subscription.createSubscription(hotelId, {
            plan,
            paymentMethod: 'cashfree',
            paymentStatus: 'pending'
        });

        // Create Cashfree order
        const orderPayload = {
            order_id: orderId,
            order_amount: planData.price,
            order_currency: 'INR', // or 'USD' based on your account
            customer_details: {
                customer_id: hotelId,
                customer_email: customerEmail || req.user.email,
                customer_phone: customerPhone || '9999999999'
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://myhotelmanagementservice.onrender.com'}/subscription-success.html?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL || 'https://myhotelmanagementservice.onrender.com'}/api/subscription/webhook`
            },
            order_note: `Subscription for ${planData.name} plan`
        };

        // Call Cashfree API
        const signature = generateCashfreeSignature(orderPayload);

        const cashfreeResponse = await fetch(`${CASHFREE_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-signature': signature
            },
            body: JSON.stringify(orderPayload)
        });

        const orderData = await cashfreeResponse.json();

        if (!cashfreeResponse.ok) {
            console.error('❌ Cashfree order creation failed:', orderData);
            return error(res, orderData.message || 'Failed to create payment order', 500);
        }

        console.log('✅ Cashfree order created:', orderData.order_id);

        // Update subscription with order ID
        await Subscription.updateSubscription(hotelId, {
            paymentId: orderData.order_id,
            transactionId: orderId
        });

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
// VERIFY PAYMENT STATUS
// ============================================================
router.get('/verify/:orderId', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        const hotelId = req.hotelId;

        // Call Cashfree API to get order status
        const signature = generateCashfreeSignature({ order_id: orderId });

        const cashfreeResponse = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-signature': signature
            }
        });

        const orderData = await cashfreeResponse.json();

        if (!cashfreeResponse.ok) {
            return error(res, orderData.message || 'Failed to verify payment', 500);
        }

        // Update subscription based on payment status
        if (orderData.order_status === 'PAID') {
            await Subscription.updateSubscription(hotelId, {
                paymentStatus: 'completed',
                status: 'active',
                transactionId: orderId
            });

            // Update tenant
            const db = getDB();
            const subscription = await Subscription.getSubscription(hotelId);
            
            await db.collection('tenants').updateOne(
                { hotelId },
                {
                    $set: {
                        subscriptionType: subscription.plan,
                        subscriptionExpiry: subscription.expiryDate,
                        active: true,
                        updatedAt: new Date()
                    }
                }
            );

            return success(res, {
                status: 'PAID',
                orderData,
                message: 'Payment successful! Subscription activated.'
            });
        } else if (orderData.order_status === 'FAILED') {
            await Subscription.updateSubscription(hotelId, {
                paymentStatus: 'failed'
            });

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
// CASHFREE WEBHOOK
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const body = req.body.toString('utf8');

        // Verify webhook signature
        if (!verifyWebhookSignature(signature, timestamp, body)) {
            console.error('❌ Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const event = JSON.parse(body);
        console.log('📥 Cashfree webhook received:', event.type);

        // Handle different payment events
        switch (event.type) {
            case 'PAYMENT_SUCCESS_WEBHOOK':
                const orderId = event.data.order.order_id;
                const hotelId = event.data.order.customer_details.customer_id;

                console.log(`✅ Payment successful for order: ${orderId}`);

                // Update subscription
                await Subscription.updateSubscription(hotelId, {
                    paymentStatus: 'completed',
                    status: 'active',
                    transactionId: orderId,
                    paymentId: orderId
                });

                // Update tenant
                const db = getDB();
                const subscription = await Subscription.getSubscription(hotelId);
                
                await db.collection('tenants').updateOne(
                    { hotelId },
                    {
                        $set: {
                            subscriptionType: subscription.plan,
                            subscriptionExpiry: subscription.expiryDate,
                            active: true,
                            updatedAt: new Date()
                        }
                    }
                );

                console.log(`✅ Subscription activated for hotel: ${hotelId}`);
                break;

            case 'PAYMENT_FAILED_WEBHOOK':
                const failedOrderId = event.data.order.order_id;
                const failedHotelId = event.data.order.customer_details.customer_id;

                console.log(`❌ Payment failed for order: ${failedOrderId}`);

                await Subscription.updateSubscription(failedHotelId, {
                    paymentStatus: 'failed'
                });
                break;

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
        const hotelId = req.hotelId;

        const subscription = await Subscription.getSubscription(hotelId);
        if (!subscription) {
            return error(res, 'No subscription found', 404);
        }

        const cancelled = await Subscription.cancelSubscription(hotelId);

        // Update tenant
        const db = getDB();
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

        return success(res, cancelled, 'Subscription cancelled');

    } catch (err) {
        return error(res, err.message, 500);
    }
});

// ============================================================
// GET ALL SUBSCRIPTIONS (Super Admin)
// ============================================================
router.get('/all', superAdminOnly, async (req, res) => {
    try {
        const { status, plan } = req.query;
        const subscriptions = await Subscription.getAllSubscriptions({ status, plan });

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
        const stats = await Subscription.getSubscriptionStats();

        return success(res, stats);

    } catch (err) {
        return error(res, err.message, 500);
    }
});

module.exports = router;
