const mongoose = require('mongoose');

const loyaltySchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  guestName: { type: String, required: true, trim: true },
  guestEmail: { type: String, lowercase: true, trim: true },
  points: { type: Number, default: 0, min: 0 },
  totalEarned: { type: Number, default: 0 },
  totalRedeemed: { type: Number, default: 0 },
  tier: { 
    type: String, 
    enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'], 
    default: 'bronze' 
  },
  pointsHistory: [{
    type: { type: String, enum: ['earn', 'redeem', 'bonus', 'adjustment'] },
    points: { type: Number, required: true },
    reason: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

loyaltySchema.index({ hotelId: 1, guestName: 1 });
loyaltySchema.index({ hotelId: 1, points: -1 });

module.exports = mongoose.model('Loyalty', loyaltySchema);