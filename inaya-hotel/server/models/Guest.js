const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema({
  name: String,
  room: String,
  email: String,
  phone: String,
  points: { type: Number, default: 0 }
});

module.exports = mongoose.model('Guest', guestSchema);
