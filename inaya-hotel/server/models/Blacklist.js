const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  name: String,
  room: String,
  reason: String,
  date: { type: String, default: () => new Date().toISOString().split('T')[0] }
});

module.exports = mongoose.model('Blacklist', blacklistSchema);
