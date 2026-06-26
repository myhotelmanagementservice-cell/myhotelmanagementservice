// server/models/Loyalty.js
// Loyalty Program Model - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const POINTS_TYPES = ['earn', 'redeem', 'bonus', 'adjustment'];

const TIER_THRESHOLDS = {
    bronze: 0,
    silver: 1000,
    gold: 5000,
    platinum: 15000,
    diamond: 50000
};

// ============================================================
// HELPER: Auto tier calculation
// ============================================================
function calculateTier(totalEarned) {
    if (totalEarned >= TIER_THRESHOLDS.diamond) return 'diamond';
    if (totalEarned >= TIER_THRESHOLDS.platinum) return 'platinum';
    if (totalEarned >= TIER_THRESHOLDS.gold) return 'gold';
    if (totalEarned >= TIER_THRESHOLDS.silver) return 'silver';
    return 'bronze';
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createLoyalty(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!data.guestName) throw new Error('Guest name is required');

        // Check duplicate
        const filter = { hotelId };
        if (data.guestEmail) filter.guestEmail = data.guestEmail.toLowerCase().trim();
        else filter.guestName = data.guestName.trim();

        const existing = await db.collection('loyalty').findOne(filter);
        if (existing) throw new Error('Loyalty record already exists');

        const loyalty = {
            hotelId,
            guestName: data.guestName.trim(),
            guestEmail: data.guestEmail ? data.guestEmail.toLowerCase().trim() : null,
            phone: data.phone || null,
            points: parseInt(data.points) || 0,
            totalEarned: parseInt(data.totalEarned) || 0,
            totalRedeemed: parseInt(data.totalRedeemed) || 0,
            tier: calculateTier(parseInt(data.totalEarned) || 0),
            pointsHistory: [],
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('loyalty').insertOne(loyalty);
        loyalty._id = result.insertedId.toString();
        return loyalty;
    } catch (error) {
        console.error('❌ createLoyalty error:', error.message);
        throw error;
    }
}

async function getLoyalty(hotelId, options = {}) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const { search, tier, limit = 50, page = 1 } = options;
        const filter = { hotelId };

        if (tier) filter.tier = tier;
        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { guestName: searchRegex },
                { guestEmail: searchRegex },
                { phone: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('loyalty')
                .find(filter)
                .sort({ points: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('loyalty').countDocuments(filter)
        ]);

        items.forEach(i => { if (i._id) i._id = i._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getLoyalty error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getLoyaltyById(hotelId, loyaltyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(loyaltyId)) return null;
        const db = getDB();
        if (!db) return null;

        const loyalty = await db.collection('loyalty').findOne({
            _id: new ObjectId(loyaltyId),
            hotelId
        });

        if (loyalty && loyalty._id) loyalty._id = loyalty._id.toString();
        return loyalty;
    } catch (error) {
        console.error('❌ getLoyaltyById error:', error.message);
        return null;
    }
}

async function getLoyaltyByGuest(hotelId, guestIdentifier) {
    try {
        if (!isConnected()) return null;
        const db = getDB();
        if (!db) return null;

        const filter = { hotelId };
        if (guestIdentifier.includes('@')) {
            filter.guestEmail = guestIdentifier.toLowerCase().trim();
        } else {
            filter.guestName = guestIdentifier.trim();
        }

        const loyalty = await db.collection('loyalty').findOne(filter);
        if (loyalty && loyalty._id) loyalty._id = loyalty._id.toString();
        return loyalty;
    } catch (error) {
        console.error('❌ getLoyaltyByGuest error:', error.message);
        return null;
    }
}

async function earnPoints(hotelId, loyaltyId, points, reason = 'Earned') {
    try {
        if (!isConnected() || !ObjectId.isValid(loyaltyId)) {
            throw new Error('Invalid loyalty ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const pointsVal = parseInt(points);
        if (isNaN(pointsVal) || pointsVal <= 0) {
            throw new Error('Points must be a positive number');
        }

        const result = await db.collection('loyalty').findOneAndUpdate(
            { _id: new ObjectId(loyaltyId), hotelId },
            {
                $inc: { points: pointsVal, totalEarned: pointsVal },
                $push: {
                    pointsHistory: {
                        $each: [{
                            type: 'earn',
                            points: pointsVal,
                            reason,
                            timestamp: new Date()
                        }],
                        $slice: -100
                    }
                },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Loyalty record not found');

        // Recalculate tier
        const newTier = calculateTier(result.totalEarned);
        if (newTier !== result.tier) {
            await db.collection('loyalty').updateOne(
                { _id: result._id },
                { $set: { tier: newTier } }
            );
            result.tier = newTier;
        }

        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ earnPoints error:', error.message);
        throw error;
    }
}

async function redeemPoints(hotelId, loyaltyId, points, reason = 'Redeemed') {
    try {
        if (!isConnected() || !ObjectId.isValid(loyaltyId)) {
            throw new Error('Invalid loyalty ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const pointsVal = parseInt(points);
        if (isNaN(pointsVal) || pointsVal <= 0) {
            throw new Error('Points must be a positive number');
        }

        const current = await db.collection('loyalty').findOne({
            _id: new ObjectId(loyaltyId),
            hotelId
        });

        if (!current) throw new Error('Loyalty record not found');
        if (current.points < pointsVal) {
            throw new Error(`Insufficient points. Available: ${current.points}`);
        }

        const result = await db.collection('loyalty').findOneAndUpdate(
            { _id: new ObjectId(loyaltyId), hotelId },
            {
                $inc: { points: -pointsVal, totalRedeemed: pointsVal },
                $push: {
                    pointsHistory: {
                        $each: [{
                            type: 'redeem',
                            points: pointsVal,
                            reason,
                            timestamp: new Date()
                        }],
                        $slice: -100
                    }
                },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ redeemPoints error:', error.message);
        throw error;
    }
}

async function deleteLoyalty(hotelId, loyaltyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(loyaltyId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('loyalty').deleteOne({
            _id: new ObjectId(loyaltyId),
            hotelId
        });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ deleteLoyalty error:', error.message);
        return false;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getTopMembers(db, hotelId, limit = 10) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const members = await db.collection('loyalty')
            .find({ hotelId })
            .sort({ points: -1 })
            .limit(limit)
            .toArray();

        members.forEach(m => { if (m._id) m._id = m._id.toString(); });
        return members;
    } catch (error) {
        console.error('❌ getTopMembers error:', error.message);
        return [];
    }
}

async function getMembersByTier(db, hotelId, tier) {
    try {
        if (!TIERS.includes(tier)) return [];
        const db = getDB();
        if (!db) return [];

        const members = await db.collection('loyalty')
            .find({ hotelId, tier })
            .sort({ points: -1 })
            .toArray();

        members.forEach(m => { if (m._id) m._id = m._id.toString(); });
        return members;
    } catch (error) {
        console.error('❌ getMembersByTier error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getLoyaltyStats(db, hotelId) {
    try {
        if (!isConnected()) return { totalMembers: 0, byTier: {}, totalPoints: 0 };
        const db = getDB();
        if (!db) return { totalMembers: 0, byTier: {}, totalPoints: 0 };

        const stats = await db.collection('loyalty').aggregate([
            { $match: { hotelId } },
            {
                $group: {
                    _id: null,
                    totalMembers: { $sum: 1 },
                    totalPoints: { $sum: '$points' },
                    totalEarned: { $sum: '$totalEarned' },
                    totalRedeemed: { $sum: '$totalRedeemed' },
                    avgPoints: { $avg: '$points' }
                }
            }
        ]).toArray();

        const byTier = await db.collection('loyalty').aggregate([
            { $match: { hotelId } },
            {
                $group: {
                    _id: '$tier',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const result = stats[0] || {
            totalMembers: 0,
            totalPoints: 0,
            totalEarned: 0,
            totalRedeemed: 0,
            avgPoints: 0
        };

        return {
            totalMembers: result.totalMembers,
            totalPoints: result.totalPoints,
            totalEarned: result.totalEarned,
            totalRedeemed: result.totalRedeemed,
            avgPoints: result.avgPoints ? result.avgPoints.toFixed(2) : 0,
            byTier: byTier.reduce((acc, s) => {
                acc[s._id] = s.count;
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('❌ getLoyaltyStats error:', error.message);
        return { totalMembers: 0, byTier: {}, totalPoints: 0 };
    }
}

async function createIndexes() {
    try {
        if (!isConnected()) return;
        const db = getDB();
        if (!db) return;

        await db.collection('loyalty').createIndex(
            { hotelId: 1, guestName: 1 },
            { background: true, name: 'hotelId_guestName_idx' }
        );
        await db.collection('loyalty').createIndex(
            { hotelId: 1, guestEmail: 1 },
            { sparse: true, background: true, name: 'hotelId_guestEmail_idx' }
        );
        await db.collection('loyalty').createIndex(
            { hotelId: 1, points: -1 },
            { background: true, name: 'hotelId_points_idx' }
        );
        await db.collection('loyalty').createIndex(
            { hotelId: 1, tier: 1 },
            { background: true, name: 'hotelId_tier_idx' }
        );

        console.log('✅ Loyalty indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    TIERS,
    POINTS_TYPES,
    TIER_THRESHOLDS,
    calculateTier,
    createLoyalty,
    getLoyalty,
    getLoyaltyById,
    getLoyaltyByGuest,
    earnPoints,
    redeemPoints,
    deleteLoyalty,
    getTopMembers,
    getMembersByTier,
    getLoyaltyStats,
    createIndexes
};