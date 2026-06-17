const mongoose = require('mongoose');

const policySchema = new mongoose.Schema({
    hotelId: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['privacy', 'terms', 'checkin', 'checkout', 'cancellation', 'refund', 'custom'],
        required: true
    },
    content: {
        en: { type: String, required: true },
        hi: { type: String, default: '' },
        ar: { type: String, default: '' }
    },
    isEnabled: {
        type: Boolean,
        default: true
    },
    _version: {
        type: Number,
        default: 1
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp on save
policySchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Policy', policySchema);