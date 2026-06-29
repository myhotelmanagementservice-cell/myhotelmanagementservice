// server/routes/subscription.js
// Subscription API Routes with Cashfree Bearer Token Authentication

const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const { getDB } = require('../config/db');
const { authMiddleware, superAdminOnly } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');
const cashfree = require('../utils/cashfree');

const CASHFREE_ENVIRONMENT = process.env.CASHFREE_ENVIRONMENT || 'sandbox';

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
// CREATE SUBSCRIPTION & CASHFREE ORDER (WITH BEARER TOKEN)
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

        // Create Cashfree order payload
        const orderPayload = {
            order_id: orderId,
            order_amount: planData.price,
            order_currency: 'INR', // ya 'USD' based on your account
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

        // ✅ Call Cashfree API with Bearer Token
        const orderData = await cashfree.createOrder(orderPayload);

        if (!orderData.order_id) {
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
// VERIFY PAYMENT STATUS (WITH BEARER TOKEN)
// ============================================================
router.get('/verify/:orderId', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        const hotelId = req.hotelId;

        // ✅ Call Cashfree API with Bearer Token
        const orderData = await cashfree.getOrderStatus(orderId);

        if (!orderData.order_id) {
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
// CASHFREE WEBHOOK (WITH SIGNATURE VERIFICATION)
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
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

                if (subscription) {
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
                }

                console.log(`✅ Subscription activated for hotel: ${hotelId}`);
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

                await Subscription.updateSubscription(failedHotelId, {
                    paymentStatus: 'failed'
                });
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