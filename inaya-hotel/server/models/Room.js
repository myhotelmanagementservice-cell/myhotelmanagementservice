const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  number: { type: Number, required: true, unique: true },
  type: { type: String, default: 'Standard' },
  status: { type: String, default: 'Vacant' },
  guestName: { type: String, default: '' },
  price: { type: Number, default: 100 }
});

module.exports = mongoose.model('Room', roomSchema);
