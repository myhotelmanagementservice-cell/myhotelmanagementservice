const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true },
  department: { type: String, default: 'General' },
  joinDate: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['online', 'offline', 'on-duty', 'on-leave', 'inactive'], 
    default: 'online' 
  },
  shift: { 
    type: String, 
    enum: ['morning', 'evening', 'night'], 
    default: 'morning' 
  },
  attendance: { 
    type: String, 
    enum: ['present', 'absent', 'half-day'], 
    default: 'present' 
  },
  rating: { type: Number, default: 5.0, min: 0, max: 5 },
  tasks: { type: Number, default: 0 },
  leaveRequest: {
    reason: String,
    date: Date,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

staffSchema.index({ hotelId: 1, department: 1 });
staffSchema.index({ hotelId: 1, status: 1 });

module.exports = mongoose.model('Staff', staffSchema);