const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  guestName: { type: String, required: true, trim: true },
  roomNumber: { type: Number, required: true },
  department: { type: String, required: true },
  category: { type: String, default: 'General' },
  description: { type: String, required: true, trim: true },
  priority: { 
    type: String, 
    enum: ['low', 'normal', 'urgent', 'emergency'], 
    default: 'normal' 
  },
  status: { 
    type: String, 
    enum: ['open', 'in_progress', 'completed', 'cancelled'], 
    default: 'open' 
  },
  assignedTo: { type: String, default: '' },
  adminReply: { type: String, default: '' },
  adminReplyTime: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

requestSchema.index({ hotelId: 1, status: 1 });
requestSchema.index({ hotelId: 1, department: 1 });
requestSchema.index({ hotelId: 1, createdAt: -1 });

module.exports = mongoose.model('Request', requestSchema);