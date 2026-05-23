const mongoose = require('mongoose');

// ============================================
// BLACKLIST SCHEMA - Guest Blacklist Management
// ============================================

const blacklistSchema = new mongoose.Schema({
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
        trim: true,
        default: ''
    },
    guestPhone: {
        type: String,
        required: [true, 'Guest phone is required']
    },
    roomNumber: {
        type: String,
        default: ''
    },

    // Blacklist Details
    reason: {
        type: String,
        required: [true, 'Reason for blacklist is required']
    },
    category: {
        type: String,
        enum: ['payment_default', 'misconduct', 'damage_property', 'violation_rules', 'fraud', 'other'],
        default: 'other'
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'permanent'],
        default: 'medium'
    },
    description: {
        type: String,
        default: ''
    },

    // Evidence/Attachments
    evidence: [{
        type: String,
        description: String,
        uploadedAt: { type: Date, default: Date.now }
    }],

    // Incident Details
    incidentDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    incidentReport: {
        type: String,
        default: ''
    },

    // Financial Details (for payment default)
    outstandingAmount: {
        type: Number,
        default: 0
    },
    currency: {
        type: String,
        default: 'USD'
    },

    // Duration
    blacklistedUntil: {
        type: Date,
        default: null
    },
    isPermanent: {
        type: Boolean,
        default: false
    },

    // Status
    status: {
        type: String,
        enum: ['active', 'expired', 'removed'],
        default: 'active'
    },

    // Action Details
    actionTakenBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    actionTakenByName: {
        type: String,
        default: ''
    },
    actionTakenAt: {
        type: Date,
        default: Date.now
    },

    // Removal Details (if removed)
    removedAt: {
        type: Date,
        default: null
    },
    removedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    removedByName: {
        type: String,
        default: ''
    },
    removalReason: {
        type: String,
        default: ''
    },

    // Notes
    notes: [{
        note: String,
        createdBy: String,
        createdAt: { type: Date, default: Date.now }
    }],

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Soft Delete
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================
// INDEXES for better performance
// ============================================
blacklistSchema.index({ hotelId: 1, guestName: 1 });
blacklistSchema.index({ hotelId: 1, guestEmail: 1 });
blacklistSchema.index({ hotelId: 1, guestPhone: 1 });
blacklistSchema.index({ hotelId: 1, status: 1 });
blacklistSchema.index({ severity: 1, status: 1 });
blacklistSchema.index({ blacklistedUntil: 1 });
blacklistSchema.index({ incidentDate: -1 });

// ============================================
// VIRTUAL FIELDS
// ============================================

// Check if blacklist is still active
blacklistSchema.virtual('isActive').get(function() {
    if (this.status !== 'active') return false;
    if (this.isPermanent) return true;
    if (this.blacklistedUntil && this.blacklistedUntil < new Date()) return false;
    return true;
});

// Get days remaining
blacklistSchema.virtual('daysRemaining').get(function() {
    if (!this.blacklistedUntil || this.isPermanent) return null;
    const diffTime = this.blacklistedUntil - new Date();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Get severity color
blacklistSchema.virtual('severityColor').get(function() {
    const colors = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        permanent: '🔴'
    };
    return colors[this.severity] || '⚪';
});

// ============================================
// INSTANCE METHODS
// ============================================

// Add note to blacklist entry
blacklistSchema.methods.addNote = async function(note, createdBy) {
    this.notes.push({ note, createdBy });
    this.updatedAt = new Date();
    return await this.save();
};

// Remove from blacklist
blacklistSchema.methods.remove = async function(reason, removedBy, removedByName) {
    this.status = 'removed';
    this.removedAt = new Date();
    this.removalReason = reason;
    this.removedBy = removedBy;
    this.removedByName = removedByName;
    this.updatedAt = new Date();
    return await this.save();
};

// Extend blacklist duration
blacklistSchema.methods.extend = async function(additionalDays) {
    if (this.isPermanent) return this;

    const currentUntil = this.blacklistedUntil || new Date();
    const newUntil = new Date(currentUntil);
    newUntil.setDate(newUntil.getDate() + additionalDays);

    this.blacklistedUntil = newUntil;
    this.updatedAt = new Date();
    return await this.save();
};

// Make permanent
blacklistSchema.methods.makePermanent = async function() {
    this.isPermanent = true;
    this.blacklistedUntil = null;
    this.updatedAt = new Date();
    return await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

// Check if guest is blacklisted
blacklistSchema.statics.isBlacklisted = async function(hotelId, guestEmail, guestPhone, guestName) {
    const query = {
        hotelId,
        status: 'active',
        $or: []
    };

    if (guestEmail) query.$or.push({ guestEmail });
    if (guestPhone) query.$or.push({ guestPhone });
    if (guestName) query.$or.push({ guestName: { $regex: guestName, $options: 'i' } });

    if (query.$or.length === 0) return null;

    const blacklisted = await this.findOne(query);

    if (!blacklisted) return null;

    // Check if expired
    if (!blacklisted.isPermanent && blacklisted.blacklistedUntil && blacklisted.blacklistedUntil < new Date()) {
        blacklisted.status = 'expired';
        await blacklisted.save();
        return null;
    }

    return blacklisted;
};

// Get active blacklists for hotel
blacklistSchema.statics.getActiveBlacklists = function(hotelId, limit = 50) {
    const now = new Date();
    return this.find({
        hotelId,
        status: 'active',
        $or: [
            { isPermanent: true },
            { blacklistedUntil: { $gt: now } }
        ]
    }).sort({ severity: -1, createdAt: -1 }).limit(limit);
};

// Get blacklists by category
blacklistSchema.statics.getByCategory = function(hotelId, category) {
    return this.find({
        hotelId,
        category,
        status: 'active'
    }).sort({ createdAt: -1 });
};

// Get statistics
blacklistSchema.statics.getStats = async function(hotelId) {
    const stats = await this.aggregate([
        { $match: { hotelId } },
        { $group: {
            _id: '$severity',
            count: { $sum: 1 }
        }}
    ]);

    const categoryStats = await this.aggregate([
        { $match: { hotelId } },
        { $group: {
            _id: '$category',
            count: { $sum: 1 }
        }}
    ]);

    return {
        total: await this.countDocuments({ hotelId }),
        active: await this.countDocuments({ hotelId, status: 'active' }),
        bySeverity: stats,
        byCategory: categoryStats
    };
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

// Auto-set blacklistedUntil based on severity
blacklistSchema.pre('save', function(next) {
    if (!this.blacklistedUntil && !this.isPermanent) {
        const days = { low: 30, medium: 90, high: 180 };
        const daysToAdd = days[this.severity] || 30;
        this.blacklistedUntil = new Date();
        this.blacklistedUntil.setDate(this.blacklistedUntil.getDate() + daysToAdd);
    }

    this.updatedAt = new Date();
    next();
});

// Update status if expired
blacklistSchema.pre('find', function() {
    this._updateExpired = true;
});

// ============================================
// POST-FIND MIDDLEWARE (Auto-update expired)
// ============================================
blacklistSchema.post('find', async function(docs) {
    const now = new Date();
    for (const doc of docs) {
        if (doc.status === 'active' && !doc.isPermanent && doc.blacklistedUntil && doc.blacklistedUntil < now) {
            doc.status = 'expired';
            await doc.save();
        }
    }
});

// ============================================
// MODEL CREATION
// ============================================
const Blacklist = mongoose.model('Blacklist', blacklistSchema);

module.exports = Blacklist;