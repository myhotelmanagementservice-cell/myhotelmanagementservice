// server/models/Subscription.js
// Subscription Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const SUBSCRIPTION_PLANS = {
    free: {
        name: 'Free Trial',
        price: 0,
        duration: 7, // days
        features: [
            'Up to 10 rooms',
            'Up to 50 guests',
            'Basic support',
            'Core features'
        ]
    },
    basic: {
        name: 'Basic',
        price: 29,
        duration: 30,
        features: [
            'Up to 50 rooms',
            'Up to 500 guests',
            'Email support',
            'All core features',
            'Basic reporting'
        ]
    },
    pro: {
        name: 'Professional',
        price: 99,
        duration: 30,
        features: [
            'Up to 200 rooms',
            'Unlimited guests',
            'Priority support',
            'All features',
            'Advanced reporting',
            'API access'
        ]
    },
    enterprise: {
        name: 'Enterprise',
        price: 499,
        duration: 365,
        features: [
            'Unlimited rooms',
            'Unlimited guests',
            '24/7 support',
            'All features',
            'Advanced analytics',
            'API access',
            'Custom integrations',
            'Dedicated manager'
        ]
    },
    lifetime: {
        name: 'Lifetime',
        price: 2999,
        duration: null, // null = lifetime
        features: [
            'Unlimited everything',
            'Lifetime access',
            '24/7 priority support',
            'All features',
            'Custom branding',
            'Priority updates'
        ]
    }
};

const PAYMENT_STATUS = ['pending', 'completed', 'failed', 'refunded', 'cancelled'];
const PAYMENT_METHODS = ['stripe', 'razorpay', 'paypal', 'bank_transfer', 'manual'];

// ============================================================
// CRUD OPERATIONS
// ============================================================

async function createSubscription(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const plan = SUBSCRIPTION_PLANS[data.plan];
        if (!plan) throw new Error('Invalid subscription plan');

        // Calculate expiry date
        let expiryDate = null;
        if (plan.duration !== null) {
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + plan.duration);
        }

        const subscription = {
            hotelId,
            plan: data.plan,
            planName: plan.name,
            price: plan.price,
            currency: data.currency || 'USD',
            status: 'active',
            startDate: new Date(),
            expiryDate,
            paymentStatus: data.paymentStatus || 'pending',
            paymentMethod: data.paymentMethod || null,
            paymentId: data.paymentId || null,
            transactionId: data.transactionId || null,
            autoRenew: data.autoRenew !== false,
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('subscriptions').insertOne(subscription);
        subscription._id = result.insertedId.toString();

        // Update tenant with subscription info
        await db.collection('tenants').updateOne(
            { hotelId },
            {
                $set: {
                    subscriptionType: data.plan,
                    subscriptionExpiry: expiryDate,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`✅ Subscription created for hotel: ${hotelId} (Plan: ${data.plan})`);
        return subscription;
    } catch (error) {
        console.error('❌ createSubscription error:', error.message);
        throw error;
    }
}

async function getSubscription(hotelId) {
    try {
        if (!isConnected()) return null;
        const db = getDB();
        if (!db) return null;

        const subscription = await db.collection('subscriptions')
            .find({ hotelId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();

        if (subscription.length === 0) return null;

        const sub = subscription[0];
        if (sub._id) sub._id = sub._id.toString();

        // Check if expired
        if (sub.expiryDate && new Date(sub.expiryDate) < new Date()) {
            sub.status = 'expired';
        }

        return sub;
    } catch (error) {
        console.error('❌ getSubscription error:', error.message);
        return null;
    }
}

async function getSubscriptionById(subscriptionId) {
    try {
        if (!isConnected() || !ObjectId.isValid(subscriptionId)) return null;
        const db = getDB();
        if (!db) return null;

        const subscription = await db.collection('subscriptions').findOne({
            _id: new ObjectId(subscriptionId)
        });

        if (subscription && subscription._id) {
            subscription._id = subscription._id.toString();
        }

        return subscription;
    } catch (error) {
        console.error('❌ getSubscriptionById error:', error.message);
        return null;
    }
}

async function updateSubscription(hotelId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const updateData = { updatedAt: new Date() };

        if (updates.status) updateData.status = updates.status;
        if (updates.paymentStatus) updateData.paymentStatus = updates.paymentStatus;
        if (updates.paymentId) updateData.paymentId = updates.paymentId;
        if (updates.transactionId) updateData.transactionId = updates.transactionId;
        if (updates.expiryDate) updateData.expiryDate = new Date(updates.expiryDate);
        if (updates.autoRenew !== undefined) updateData.autoRenew = updates.autoRenew;

        const result = await db.collection('subscriptions').findOneAndUpdate(
            { hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Subscription not found');
        if (result._id) result._id = result._id.toString();

        return result;
    } catch (error) {
        console.error('❌ updateSubscription error:', error.message);
        throw error;
    }
}

async function cancelSubscription(hotelId) {
    try {
        return await updateSubscription(hotelId, {
            status: 'cancelled',
            autoRenew: false
        });
    } catch (error) {
        console.error('❌ cancelSubscription error:', error.message);
        throw error;
    }
}

async function renewSubscription(hotelId, plan) {
    try {
        const planData = SUBSCRIPTION_PLANS[plan];
        if (!planData) throw new Error('Invalid plan');

        let expiryDate = null;
        if (planData.duration !== null) {
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + planData.duration);
        }

        return await updateSubscription(hotelId, {
            status: 'active',
            expiryDate,
            paymentStatus: 'pending'
        });
    } catch (error) {
        console.error('❌ renewSubscription error:', error.message);
        throw error;
    }
}

async function getAllSubscriptions(filters = {}) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const query = {};
        if (filters.status) query.status = filters.status;
        if (filters.plan) query.plan = filters.plan;

        const subscriptions = await db.collection('subscriptions')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        subscriptions.forEach(s => { if (s._id) s._id = s._id.toString(); });
        return subscriptions;
    } catch (error) {
        console.error('❌ getAllSubscriptions error:', error.message);
        return [];
    }
}

async function getSubscriptionStats() {
    try {
        if (!isConnected()) return { total: 0, byPlan: {}, byStatus: {}, revenue: 0 };
        const db = getDB();
        if (!db) return { total: 0, byPlan: {}, byStatus: {}, revenue: 0 };

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

        return {
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
        };
    } catch (error) {
        console.error('❌ getSubscriptionStats error:', error.message);
        return { total: 0, byPlan: {}, byStatus: {}, revenue: 0 };
    }
}

async function createIndexes() {
    try {
        if (!isConnected()) return;
        const db = getDB();
        if (!db) return;

        await db.collection('subscriptions').createIndex(
            { hotelId: 1 },
            { unique: true, background: true, name: 'hotelId_unique' }
        );
        await db.collection('subscriptions').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('subscriptions').createIndex(
            { expiryDate: 1 },
            { background: true, name: 'expiryDate_idx' }
        );

        console.log('✅ Subscription indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    SUBSCRIPTION_PLANS,
    PAYMENT_STATUS,
    PAYMENT_METHODS,
    createSubscription,
    getSubscription,
    getSubscriptionById,
    updateSubscription,
    cancelSubscription,
    renewSubscription,
    getAllSubscriptions,
    getSubscriptionStats,
    createIndexes
};
