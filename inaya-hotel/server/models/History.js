const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
    hotelId: { type: String, required: true, index: true },
    guestName: { type: String, required: true },
    type: { type: String, required: true }, // 'request', 'booking', 'cab'
    referenceId: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, default: '' },
    date: { type: String, default: () => new Date().toISOString() },
    _version: { type: Number, default: 1 }
}, { timestamps: true });

// Compound index for faster queries
HistorySchema.index({ hotelId: 1, guestName: 1, date: -1 });

module.exports = mongoose.model('History', HistorySchema);
