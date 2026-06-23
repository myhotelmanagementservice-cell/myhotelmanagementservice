const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, index: true },
    guest: { type: String, required: true },
    room: { type: Number, default: null },
    overall: { type: Number, required: true, min: 1, max: 5 },
    service: { type: Number, min: 1, max: 5 },
    cleanliness: { type: Number, min: 1, max: 5 },
    comment: { type: String, default: '' },
    recommend: { type: Boolean, default: true },
    date: { type: String, default: () => new Date().toISOString() },
    _version: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Review', ReviewSchema);
