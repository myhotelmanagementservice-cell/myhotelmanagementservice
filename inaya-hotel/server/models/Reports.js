const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, index: true },
    type: { type: String, required: true }, // bookings, requests, guests, rooms, revenue
    from: { type: String, required: true },
    to: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    total: { type: Number, default: 0 },
    generatedAt: { type: String, default: () => new Date().toISOString() },
    user: { type: String, default: 'System' }
}, { timestamps: true });

module.exports = mongoose.model('Report', ReportSchema);

