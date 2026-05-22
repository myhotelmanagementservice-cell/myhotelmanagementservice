cat > server/models/Request.js << 'EOF'
const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  guestName: { type: String, required: true },
  roomNumber: { type: String, required: true },
  department: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'emergency'], default: 'medium' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  assignedTo: { type: String, default: '' },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Request', RequestSchema);
EOF