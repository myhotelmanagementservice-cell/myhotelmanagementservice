cat > server/models/Hotel.js << 'EOF'
const mongoose = require('mongoose');

const HotelSchema = new mongoose.Schema({
  hotelId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  country: { type: String, required: true },
  countryCode: { type: String, required: true },
  currency: { type: String, default: 'USD' },
  currencySymbol: { type: String, default: '$' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  language: { type: String, default: 'en' },
  wifiPassword: { type: String, default: 'CrownPlaza@2024' },
  logo: { type: String, default: '' },
  theme: {
    primaryColor: { type: String, default: '#667eea' },
    secondaryColor: { type: String, default: '#764ba2' }
  },
  isActive: { type: Boolean, default: true },
  subscription: { type: String, default: 'free' }
}, { timestamps: true });

module.exports = mongoose.model('Hotel', HotelSchema);
EOF