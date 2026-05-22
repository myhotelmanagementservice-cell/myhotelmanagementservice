cat > server/models/Room.js << 'EOF'
const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  roomNumber: { type: String, required: true },
  type: { type: String, enum: ['Standard', 'Deluxe', 'Suite', 'Presidential'], default: 'Standard' },
  price: { type: Number, default: 0 },
  status: { type: String, enum: ['Vacant', 'Occupied', 'Cleaning', 'Maintenance'], default: 'Vacant' },
  floor: { type: Number, default: 1 },
  amenities: [{ type: String }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

RoomSchema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('Room', RoomSchema);
EOF