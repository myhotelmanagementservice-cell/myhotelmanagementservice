cat > server/models/Guest.js << 'EOF'
const mongoose = require('mongoose');

const GuestSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  roomNumber: { type: String, required: true },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  nationality: { type: String, default: '' },
  idProof: { type: String, default: '' },
  loyaltyPoints: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Guest', GuestSchema);
EOF