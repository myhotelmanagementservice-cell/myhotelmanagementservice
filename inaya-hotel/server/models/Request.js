const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  guestName: String,
  roomNumber: String,
  department: String,
  category: String,
  description: String,
  priority: { type: String, default: 'normal' },
  status: { type: String, default: 'open' },
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

module.exports = mongoose.model('Request', requestSchema);
