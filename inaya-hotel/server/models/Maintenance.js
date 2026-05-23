const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  room: String,
  task: String,
  date: String,
  status: String,
  priority: String
});

module.exports = mongoose.model('Maintenance', maintenanceSchema);
