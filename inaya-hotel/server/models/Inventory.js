const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  item: String,
  quantity: Number,
  unit: String,
  minStock: Number
});

module.exports = mongoose.model('Inventory', inventorySchema);
