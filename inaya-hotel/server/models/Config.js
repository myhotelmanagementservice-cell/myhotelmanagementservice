const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    hotelId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        default: 'Crown Plaza Hotel'
    },
    currency: {
        type: String,
        default: 'SAR'
    },
    wifi: {
        type: String,
        default: 'CrownPlaza@2024'
    },
    airportPrice: {
        type: Number,
        default: 115
    },
    localPrice: {
        type: Number,
        default: 60
    },
    currencies: {
        type: Object,
        default: {
            INR: { symbol: '₹', rate: 83.50, flag: '🇮🇳', custom: false },
            SAR: { symbol: '﷼', rate: 3.75, flag: '🇸🇦', custom: false },
            AED: { symbol: 'د.إ', rate: 3.67, flag: '🇦🇪', custom: false },
            USD: { symbol: '$', rate: 1.00, flag: '🇺🇸', custom: false },
            KWD: { symbol: 'د.ك', rate: 0.31, flag: '🇰🇼', custom: false }
        }
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
configSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ✅ FIX: currencies Object update hone pe Mongoose ko batao
// Mongoose by default nested Object changes track nahi karta
configSchema.pre('save', function(next) {
    if (this.isModified('currencies') || this.currencies) {
        this.markModified('currencies');
    }
    next();
});

module.exports = mongoose.model('Config', configSchema);