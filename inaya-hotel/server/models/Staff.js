const mongoose = require('mongoose');

const StaffSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  role: { type: String, required: true },
  department: { type: String, default: 'General' },
  joinDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['online', 'offline', 'on-leave', 'on-duty'], default: 'online' },
  shift: { type: String, enum: ['morning', 'evening', 'night'], default: 'morning' },
  attendance: { type: String, enum: ['present', 'absent', 'half-day'], default: 'present' },
  rating: { type: Number, default: 5.0 },
  tasks: { type: Number, default: 0 },
  leaveRequest: { type: Object, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Staff', StaffSchema);
