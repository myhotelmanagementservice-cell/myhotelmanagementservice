const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  number: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['Standard', 'Deluxe', 'Suite', 'Presidential', 'Family'], 
    default: 'Standard' 
  },
  status: { 
    type: String, 
    enum: ['Vacant', 'Occupied', 'Cleaning', 'Maintenance', 'Reserved'], 
    default: 'Vacant' 
  },
  basePriceSAR: { type: Number, required: true, min: 0 },
  guestName: { type: String, default: '', trim: true },
  amenities: [{ type: String }],
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Room number must be unique per hotel
roomSchema.index({ hotelId: 1, number: 1 }, { unique: true });
roomSchema.index({ hotelId: 1, status: 1 });

module.exports = mongoose.model('Room', roomSchema);