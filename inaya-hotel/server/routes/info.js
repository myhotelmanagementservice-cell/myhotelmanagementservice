const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const getHotelId = (req) => req.query.hotelId || req.headers['x-hotel-id'] || 'default';

// GET: Hotel info
router.get('/', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const [config, tenant, settings] = await Promise.all([
            db.collection('config').findOne({ hotelId }),
            db.collection('tenants').findOne({ hotelId }),
            db.collection('settings').findOne({ hotelId })
        ]);
        
        const info = {
            hotelId,
            name: tenant?.hotelName || config?.name || 'Crown Plaza Hotel',
            currency: config?.currency || 'SAR',
            currencySymbol: tenant?.currencySymbol || '﷼',
            language: tenant?.language || 'en',
            wifi: config?.wifi || `${hotelId}_Guest`,
            wifiPassword: settings?.wifiPassword || 'Welcome123',
            airportPrice: config?.airportPrice || 115,
            localPrice: config?.localPrice || 60,
            phone: tenant?.phone || '+966 12 345 6789',
            email: tenant?.email || 'info@crownplaza.com',
            address: tenant?.address || '123 King Road, Riyadh, Saudi Arabia',
            checkIn: settings?.checkIn || '2:00 PM',
            checkOut: settings?.checkOut || '12:00 PM',
            amenities: settings?.amenities || ['WiFi', 'Parking', 'Pool', 'Gym', 'Restaurant'],
            about: tenant?.about || 'Welcome to Crown Plaza Hotel. Experience luxury and comfort in the heart of the city.'
        };
        
        res.json(info);
    } catch (err) {
        console.error('Error fetching hotel info:', err);
        res.status(500).json({ error: 'Server error fetching hotel info' });
    }
});

// GET: WiFi info
router.get('/wifi', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const config = await db.collection('config').findOne({ hotelId });
        const settings = await db.collection('settings').findOne({ hotelId });
        
        res.json({
            ssid: config?.wifi || `${hotelId}_Guest`,
            password: settings?.wifiPassword || 'Welcome123'
        });
    } catch (err) {
        console.error('Error fetching WiFi info:', err);
        res.status(500).json({ error: 'Server error fetching WiFi info' });
    }
});

// GET: Contact info
router.get('/contact', async (req, res) => {
    try {
        const hotelId = getHotelId(req);
        const db = req.app.get('db');
        
        const tenant = await db.collection('tenants').findOne({ hotelId });
        
        res.json({
            phone: tenant?.phone || '+966 12 345 6789',
            email: tenant?.email || 'info@crownplaza.com',
            address: tenant?.address || '123 King Road, Riyadh, Saudi Arabia'
        });
    } catch (err) {
        console.error('Error fetching contact info:', err);
        res.status(500).json({ error: 'Server error fetching contact info' });
    }
});

module.exports = router;
