const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    hotelId: {
        type: String,
        required: true,
        index: true
    },
    category: {
        type: String,
        enum: ['welcome', 'offer', 'promo', 'service', 'wifi', 'emergency'],
        required: true
    },
    title: {
        en: { type: String, required: true },
        hi: { type: String, default: '' },
        ar: { type: String, default: '' }
    },
    message: {
        en: { type: String, required: true },
        hi: { type: String, default: '' },
        ar: { type: String, default: '' }
    },
    isActive: {
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
announcementSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Announcement', announcementSchema);