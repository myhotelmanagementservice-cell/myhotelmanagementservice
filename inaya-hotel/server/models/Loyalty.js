const mongoose = require('mongoose');

// ============================================
// LOYALTY SCHEMA - Guest Loyalty Points System
// ============================================

const loyaltySchema = new mongoose.Schema({
    // Multi-tenant support
    hotelId: {
        type: String,
        required: [true, 'Hotel ID is required'],
        index: true
    },

    // Guest Information
    guestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Guest',
        required: true,
        index: true
    },
    guestName: {
        type: String,
        required: [true, 'Guest name is required'],
        trim: true
    },
    guestEmail: {
        type: String,
        lowercase: true,
        trim: true
    },
    guestPhone: {
        type: String,
        default: ''
    },

    // Loyalty Points
    points: {
        type: Number,
        default: 0,
        min: 0
    },
    totalPointsEarned: {
        type: Number,
        default: 0
    },
    totalPointsRedeemed: {
        type: Number,
        default: 0
    },

    // Tier/Rank
    tier: {
        type: String,
        enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'],
        default: 'bronze'
    },
    tierProgress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },

    // Points Settings (Hotel-specific)
    pointsPerNight: {
        type: Number,
        default: 100
    },
    pointsPerDollar: {
        type: Number,
        default: 10
    },
    bonusPointsMultiplier: {
        type: Number,
        default: 1
    },

    // Points History
    pointsHistory: [{
        type: {
            type: String,
            enum: ['earn', 'redeem', 'bonus', 'adjustment', 'expiry', 'refund'],
            required: true
        },
        points: { type: Number, required: true },
        balance: { type: Number, required: true },
        reason: { type: String, required: true },
        reference: { type: String, default: '' }, // Booking ID, Request ID, etc.
        referenceType: { type: String, enum: ['booking', 'request', 'food', 'review', 'referral', 'admin'], default: 'admin' },
        performedBy: { type: String, default: '' },
        performedAt: { type: Date, default: Date.now },
        expiryDate: { type: Date, default: null },
        notes: { type: String, default: '' }
    }],

    // Redemption History
    redemptionHistory: [{
        redemptionId: { type: String, default: () => 'RDM' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase() },
        pointsRedeemed: { type: Number, required: true },
        reward: { type: String, required: true },
        rewardType: { type: String, enum: ['discount', 'free_room', 'free_meal', 'upgrade', 'voucher', 'other'], default: 'discount' },
        value: { type: Number, default: 0 },
        status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'completed' },
        redeemedAt: { type: Date, default: Date.now },
        expiryDate: { type: Date, default: null },
        usedAt: { type: Date, default: null }
    }],

    // Milestones Achieved
    milestones: [{
        name: String,
        description: String,
        pointsAwarded: Number,
        achievedAt: { type: Date, default: Date.now }
    }],

    // Referral Information
    referredBy: {
        guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest' },
        guestName: { type: String, default: '' },
        referralCode: { type: String, default: '' }
    },
    referrals: [{
        guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest' },
        guestName: String,
        pointsAwarded: Number,
        referredAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'completed'], default: 'completed' }
    }],

    // Statistics
    stats: {
        totalBookings: { type: Number, default: 0 },
        totalSpent: { type: Number, default: 0 },
        totalNights: { type: Number, default: 0 },
        lastVisit: { type: Date, default: null },
        firstVisit: { type: Date, default: null },
        favoriteRoomType: { type: String, default: '' }
    },

    // Status
    isActive: {
        type: Boolean,
        default: true
    },

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Points Expiry
    pointsExpiryDate: {
        type: Date,
        default: null
    },
    lastPointsEarned: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================
// INDEXES for better performance
// ============================================
loyaltySchema.index({ hotelId: 1, guestId: 1 });
loyaltySchema.index({ hotelId: 1, points: -1 });
loyaltySchema.index({ hotelId: 1, tier: 1 });
loyaltySchema.index({ guestEmail: 1 });
loyaltySchema.index({ referredBy: 1 });
loyaltySchema.index({ pointsExpiryDate: 1 });

// ============================================
// TIER THRESHOLDS
// ============================================
const tierThresholds = {
    bronze: { points: 0, multiplier: 1.0, color: '🟤', benefits: ['Welcome points', 'Birthday bonus'] },
    silver: { points: 1000, multiplier: 1.2, color: '⚪', benefits: ['Welcome points', 'Birthday bonus', '5% discount on food'] },
    gold: { points: 5000, multiplier: 1.5, color: '🟡', benefits: ['Welcome points', 'Birthday bonus', '10% discount on food', 'Room upgrade priority'] },
    platinum: { points: 10000, multiplier: 2.0, color: '🔵', benefits: ['Welcome points', 'Birthday bonus', '15% discount on food', 'Room upgrade', 'Late checkout'] },
    diamond: { points: 25000, multiplier: 2.5, color: '💎', benefits: ['Welcome points', 'Birthday bonus', '20% discount on food', 'Room upgrade', 'Late checkout', 'Free airport transfer'] }
};

// ============================================
// VIRTUAL FIELDS
// ============================================

// Next tier info
loyaltySchema.virtual('nextTier').get(function() {
    const tiers = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const currentIndex = tiers.indexOf(this.tier);
    if (currentIndex === tiers.length - 1) return null;

    const nextTierName = tiers[currentIndex + 1];
    const nextThreshold = tierThresholds[nextTierName].points;
    const pointsNeeded = nextThreshold - this.points;

    return {
        name: nextTierName,
        pointsNeeded: Math.max(0, pointsNeeded),
        threshold: nextThreshold,
        benefits: tierThresholds[nextTierName].benefits
    };
});

// Progress to next tier
loyaltySchema.virtual('progressToNextTier').get(function() {
    const currentThreshold = tierThresholds[this.tier].points;
    const nextThreshold = this.nextTier ? tierThresholds[this.nextTier.name].points : this.points;
    const earnedInTier = this.points - currentThreshold;
    const neededForNext = nextThreshold - currentThreshold;

    if (neededForNext <= 0) return 100;
    return Math.min(100, Math.floor((earnedInTier / neededForNext) * 100));
});

// Tier color
loyaltySchema.virtual('tierColor').get(function() {
    return tierThresholds[this.tier].color;
});

// Tier multiplier
loyaltySchema.virtual('tierMultiplier').get(function() {
    return tierThresholds[this.tier].multiplier;
});

// ============================================
// INSTANCE METHODS
// ============================================

// Add points
loyaltySchema.methods.addPoints = async function(points, reason, reference = '', referenceType = 'admin', performedBy = '') {
    const actualPoints = Math.floor(points * this.tierMultiplier);

    this.points += actualPoints;
    this.totalPointsEarned += actualPoints;
    this.lastPointsEarned = new Date();
    this.updatedAt = new Date();

    this.pointsHistory.push({
        type: 'earn',
        points: actualPoints,
        balance: this.points,
        reason: reason,
        reference: reference,
        referenceType: referenceType,
        performedBy: performedBy
    });

    await this.updateTier();
    return await this.save();
};

// Redeem points
loyaltySchema.methods.redeemPoints = async function(points, reward, rewardType, value, expiryDate = null) {
    if (this.points < points) {
        throw new Error(`Insufficient points. Available: ${this.points}, Requested: ${points}`);
    }

    this.points -= points;
    this.totalPointsRedeemed += points;
    this.updatedAt = new Date();

    this.pointsHistory.push({
        type: 'redeem',
        points: -points,
        balance: this.points,
        reason: `Redeemed ${points} points for ${reward}`,
        reference: reward,
        referenceType: 'redeem',
        expiryDate: expiryDate
    });

    this.redemptionHistory.push({
        pointsRedeemed: points,
        reward: reward,
        rewardType: rewardType,
        value: value,
        expiryDate: expiryDate
    });

    await this.updateTier();
    return await this.save();
};

// Update tier based on points
loyaltySchema.methods.updateTier = async function() {
    let newTier = this.tier;

    if (this.points >= tierThresholds.diamond.points) {
        newTier = 'diamond';
    } else if (this.points >= tierThresholds.platinum.points) {
        newTier = 'platinum';
    } else if (this.points >= tierThresholds.gold.points) {
        newTier = 'gold';
    } else if (this.points >= tierThresholds.silver.points) {
        newTier = 'silver';
    } else {
        newTier = 'bronze';
    }

    if (newTier !== this.tier) {
        const oldTier = this.tier;
        this.tier = newTier;

        // Award tier upgrade bonus
        const upgradeBonus = tierThresholds[newTier].points * 0.1;
        this.points += upgradeBonus;
        this.totalPointsEarned += upgradeBonus;

        this.pointsHistory.push({
            type: 'bonus',
            points: upgradeBonus,
            balance: this.points,
            reason: `Tier upgrade from ${oldTier} to ${newTier}`,
            referenceType: 'admin'
        });
    }

    return this;
};

// Add milestone
loyaltySchema.methods.addMilestone = async function(name, description, pointsAwarded) {
    this.milestones.push({
        name: name,
        description: description,
        pointsAwarded: pointsAwarded
    });

    if (pointsAwarded > 0) {
        await this.addPoints(pointsAwarded, `Milestone achieved: ${name}`, name, 'milestone');
    }

    return await this.save();
};

// Add referral
loyaltySchema.methods.addReferral = async function(referredGuestId, referredGuestName, pointsAwarded = 50) {
    this.referrals.push({
        guestId: referredGuestId,
        guestName: referredGuestName,
        pointsAwarded: pointsAwarded
    });

    await this.addPoints(pointsAwarded, `Referral bonus for inviting ${referredGuestName}`, referredGuestId, 'referral');
    return await this.save();
};

// Update stats
loyaltySchema.methods.updateStats = async function(booking) {
    this.stats.totalBookings += 1;
    this.stats.totalSpent += booking.totalPrice || 0;
    this.stats.totalNights += booking.nights || 0;
    this.stats.lastVisit = new Date();

    if (!this.stats.firstVisit) {
        this.stats.firstVisit = new Date();
    }

    // Earn points from booking
    const pointsEarned = (booking.totalPrice || 0) * this.pointsPerDollar;
    await this.addPoints(pointsEarned, `Points earned from booking ${booking.bookingNumber}`, booking._id, 'booking');

    return await this.save();
};

// Check and expire old points
loyaltySchema.methods.expireOldPoints = async function() {
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() - 1);

    const expiredPoints = this.pointsHistory
        .filter(h => h.type === 'earn' && h.performedAt < expiryDate)
        .reduce((sum, h) => sum + h.points, 0);

    if (expiredPoints > 0 && this.points >= expiredPoints) {
        this.points -= expiredPoints;
        this.pointsHistory.push({
            type: 'expiry',
            points: -expiredPoints,
            balance: this.points,
            reason: `${expiredPoints} points expired after 1 year`,
            referenceType: 'system'
        });
        await this.save();
    }

    return this;
};

// ============================================
// STATIC METHODS
// ============================================

// Get leaderboard
loyaltySchema.statics.getLeaderboard = async function(hotelId, limit = 10) {
    return await this.find({ hotelId, isActive: true })
        .sort({ points: -1 })
        .limit(limit)
        .select('guestName guestEmail points tier');
};

// Get points summary
loyaltySchema.statics.getPointsSummary = async function(hotelId) {
    const summary = await this.aggregate([
        { $match: { hotelId, isActive: true } },
        { $group: {
            _id: '$tier',
            count: { $sum: 1 },
            totalPoints: { $sum: '$points' },
            avgPoints: { $avg: '$points' }
        }}
    ]);

    const total = await this.aggregate([
        { $match: { hotelId, isActive: true } },
        { $group: {
            _id: null,
            totalGuests: { $sum: 1 },
            totalPoints: { $sum: '$points' },
            totalEarned: { $sum: '$totalPointsEarned' },
            totalRedeemed: { $sum: '$totalPointsRedeemed' }
        }}
    ]);

    return { summary, total: total[0] || {} };
};

// Find by tier
loyaltySchema.statics.findByTier = function(hotelId, tier) {
    return this.find({ hotelId, tier, isActive: true }).sort({ points: -1 });
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

// Update tier before save
loyaltySchema.pre('save', async function(next) {
    await this.updateTier();
    next();
});

// ============================================
// MODEL CREATION
// ============================================
const Loyalty = mongoose.model('Loyalty', loyaltySchema);

module.exports = Loyalty;