const mongoose = require('mongoose');

const InfoSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'Crown Plaza Hotel' },
    currency: { type: String, default: 'SAR' },
    currencySymbol: { type: String, default: '﷼' },
    language: { type: String, default: 'en' },
    wifi: { type: String, default: '' },
    wifiPassword: { type: String, default: 'Welcome123' },
    airportPrice: { type: Number, default: 115 },
    localPrice: { type: Number, default: 60 },
    phone: { type: String, default: '+966 12 345 6789' },
    email: { type: String, default: 'info@crownplaza.com' },
    address: { type: String, default: '123 King Road, Riyadh, Saudi Arabia' },
    checkIn: { type: String, default: '2:00 PM' },
    checkOut: { type: String, default: '12:00 PM' },
    amenities: { type: [String], default: ['WiFi', 'Parking', 'Pool', 'Gym', 'Restaurant'] },
    about: { type: String, default: 'Welcome to Crown Plaza Hotel. Experience luxury and comfort in the heart of the city.' },
    _version: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Info', InfoSchema);
