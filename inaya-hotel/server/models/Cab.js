const mongoose = require('mongoose');

const CabSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, index: true },
    guestName: { type: String, required: true },
    roomNumber: { type: Number, required: true },
    type: { type: String, required: true }, // 'airport' or 'local'
    pickupTime: { type: String, default: () => new Date().toISOString() },
    notes: { type: String, default: '' },
    status: { type: String, default: 'pending' }, // pending, confirmed, completed, cancelled
    price: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: { type: String, default: () => new Date().toISOString() },
    _version: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Cab', CabSchema);
