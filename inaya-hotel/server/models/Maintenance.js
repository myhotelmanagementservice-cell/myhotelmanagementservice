const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  task: { type: String, required: true, trim: true },
  area: { type: String, required: true, trim: true },
  scheduled: { type: Date },
  assignedTo: { type: String, default: '' },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'], 
    default: 'medium' 
  },
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'cancelled'], 
    default: 'pending' 
  },
  notes: [{ 
    text: String, 
    by: String, 
    timestamp: { type: Date, default: Date.now } 
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

maintenanceSchema.index({ hotelId: 1, status: 1 });
maintenanceSchema.index({ hotelId: 1, scheduled: 1 });

module.exports = mongoose.model('Maintenance', maintenanceSchema);