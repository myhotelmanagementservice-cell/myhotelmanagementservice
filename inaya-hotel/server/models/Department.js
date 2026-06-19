const mongoose = require('mongoose');

// Category Sub-schema (Departments ke andar categories hongi)
const categorySchema = new mongoose.Schema({
    key: { type: String, required: true },
    emoji: { type: String, default: '📂' },
    name: {
        en: { type: String, default: '' },
        hi: { type: String, default: '' },
        ar: { type: String, default: '' }
    }
}, { _id: false });

// Main Department Schema
const departmentSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, index: true }, // Multi-tenant support
    key: { type: String, required: true }, // Unique identifier (e.g., 'housekeeping')
    emoji: { type: String, default: '🏢' },
    name: {
        en: { type: String, required: true },
        hi: { type: String, default: '' },
        ar: { type: String, default: '' }
    },
    isEnabled: { type: Boolean, default: true },
    categories: [categorySchema],
    _version: { type: Number, default: 1 } // For sync conflict resolution
}, { timestamps: true });

// Compound index: Ek hotel ke andar department ka 'key' unique hona chahiye
departmentSchema.index({ hotelId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);