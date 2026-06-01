const mongoose = require('mongoose');

const HotelSchema = new mongoose.Schema({
  hotelId: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    index: true // ✅ Optimization: Fast lookup by Hotel ID
  },
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  country: { 
    type: String, 
    required: true, 
    trim: true 
  },
  countryCode: { 
    type: String, 
    required: true, 
    uppercase: true, // ✅ Auto-uppercase country codes (e.g., 'sa' -> 'SA')
    trim: true 
  },
  currency: { 
    type: String, 
    default: 'USD', 
    enum: ['USD', 'SAR', 'INR', 'AED', 'EUR', 'GBP'] // ✅ Data Integrity: Valid currencies only
  },
  currencySymbol: { 
    type: String, 
    default: '$' 
  },
  timezone: { 
    type: String, 
    default: 'UTC' 
  },
  language: { 
    type: String, 
    default: 'en',
    enum: ['en', 'hi', 'ar', 'fr'] // ✅ Supported languages
  },
  wifiPassword: { 
    type: String, 
    default: 'CrownPlaza@2024' 
  },
  logo: { 
    type: String, 
    default: '' 
  },
  theme: {
    primaryColor: { type: String, default: '#667eea' },
    secondaryColor: { type: String, default: '#764ba2' }
  },
  isActive: { 
    type: Boolean, 
    default: true,
    index: true // ✅ Optimization: Fast filtering for active/inactive hotels
  },
  subscription: { 
    type: String, 
    default: 'free',
    enum: ['free', 'basic', 'pro', 'enterprise'] // ✅ Valid subscription plans
  },
  // ✅ ADDED: Settings object for dynamic hotel configs (Prices, Limits)
  settings: {
    type: Object,
    default: {
      airportTransferPrice: 30,
      localCabPricePerHour: 15,
      maxStaff: 10
    }
  }
}, { timestamps: true });

// ✅ AUTO-SYMBOL HOOK: Automatically update currency symbol when currency changes
HotelSchema.pre('save', function(next) {
  if (this.isModified('currency')) {
    const symbolMap = {
      'USD': '$', 'SAR': '﷼', 'INR': '₹', 'AED': 'د.إ', 'EUR': '€', 'GBP': '£'
    };
    this.currencySymbol = symbolMap[this.currency] || '$';
  }
  next();
});

module.exports = mongoose.model('Hotel', HotelSchema);