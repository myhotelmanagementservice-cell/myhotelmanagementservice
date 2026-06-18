const express = require('express');
const router = express.Router();
const Config = require('../models/Config');

// GET config for a hotel
router.get('/', async (req, res) => {
    try {
        const { hotelId } = req.query;
        if (!hotelId) {
            return res.status(400).json({ error: 'hotelId is required' });
        }
        let config = await Config.findOne({ hotelId });
        if (!config) {
            // Create default config if not exists
            config = new Config({
                hotelId,
                name: 'Crown Plaza Hotel',
                currency: 'SAR',
                wifi: 'CrownPlaza@2024',
                airportPrice: 115,
                localPrice: 60,
                currencies: {
                    INR: { symbol: '₹', rate: 83.50, flag: '🇮🇳', custom: false },
                    SAR: { symbol: '﷼', rate: 3.75, flag: '🇸🇦', custom: false },
                    AED: { symbol: 'د.إ', rate: 3.67, flag: '🇦🇪', custom: false },
                    USD: { symbol: '$', rate: 1.00, flag: '🇺🇸', custom: false },
                    KWD: { symbol: 'د.ك', rate: 0.31, flag: '🇰🇼', custom: false }
                },
                _version: 1
            });
            await config.save();
        }
        res.json(config);
    } catch (error) {
        console.error('GET /config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET single config by id
router.get('/:id', async (req, res) => {
    try {
        const config = await Config.findById(req.params.id);
        if (!config) {
            return res.status(404).json({ error: 'Config not found' });
        }
        res.json(config);
    } catch (error) {
        console.error('GET /config/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST create or update config (FIXED: upsert instead of 400 error)
router.post('/', async (req, res) => {
    try {
        const { hotelId, name, currency, wifi, airportPrice, localPrice, currencies } = req.body;
        if (!hotelId) {
            return res.status(400).json({ error: 'hotelId is required' });
        }

        // Check if config already exists
        let config = await Config.findOne({ hotelId });

        if (config) {
            // Already exists — update kar do (400 error nahi dena)
            if (name !== undefined) config.name = name;
            if (currency !== undefined) config.currency = currency;
            if (wifi !== undefined) config.wifi = wifi;
            if (airportPrice !== undefined) config.airportPrice = airportPrice;
            if (localPrice !== undefined) config.localPrice = localPrice;
            if (currencies !== undefined) config.currencies = currencies;
            config._version = (config._version || 0) + 1;
            config.updatedAt = new Date();
        } else {
            // Naya config banao
            config = new Config({
                hotelId,
                name: name || 'Crown Plaza Hotel',
                currency: currency || 'SAR',
                wifi: wifi || 'CrownPlaza@2024',
                airportPrice: airportPrice || 115,
                localPrice: localPrice || 60,
                currencies: currencies || {
                    INR: { symbol: '₹', rate: 83.50, flag: '🇮🇳', custom: false },
                    SAR: { symbol: '﷼', rate: 3.75, flag: '🇸🇦', custom: false },
                    AED: { symbol: 'د.إ', rate: 3.67, flag: '🇦🇪', custom: false },
                    USD: { symbol: '$', rate: 1.00, flag: '🇺🇸', custom: false },
                    KWD: { symbol: 'د.ك', rate: 0.31, flag: '🇰🇼', custom: false }
                },
                _version: 1
            });
        }

        await config.save();
        res.status(201).json(config);
    } catch (error) {
        console.error('POST /config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update config by MongoDB _id
router.put('/:id', async (req, res) => {
    try {
        const { name, currency, wifi, airportPrice, localPrice, currencies } = req.body;
        const config = await Config.findById(req.params.id);
        if (!config) {
            return res.status(404).json({ error: 'Config not found' });
        }
        if (name !== undefined) config.name = name;
        if (currency !== undefined) config.currency = currency;
        if (wifi !== undefined) config.wifi = wifi;
        if (airportPrice !== undefined) config.airportPrice = airportPrice;
        if (localPrice !== undefined) config.localPrice = localPrice;
        if (currencies !== undefined) config.currencies = currencies;
        config._version = (config._version || 0) + 1;
        config.updatedAt = new Date();
        await config.save();
        res.json(config);
    } catch (error) {
        console.error('PUT /config/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update config by hotelId (MAIN ROUTE — HTML isko use karta hai)
router.put('/hotel/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const { name, currency, wifi, airportPrice, localPrice, currencies } = req.body;

        let config = await Config.findOne({ hotelId });

        if (!config) {
            // Config exist nahi karta — naya banao
            config = new Config({
                hotelId,
                name: name || 'Crown Plaza Hotel',
                currency: currency || 'SAR',
                wifi: wifi || 'CrownPlaza@2024',
                airportPrice: airportPrice || 115,
                localPrice: localPrice || 60,
                currencies: currencies || {
                    INR: { symbol: '₹', rate: 83.50, flag: '🇮🇳', custom: false },
                    SAR: { symbol: '﷼', rate: 3.75, flag: '🇸🇦', custom: false },
                    AED: { symbol: 'د.إ', rate: 3.67, flag: '🇦🇪', custom: false },
                    USD: { symbol: '$', rate: 1.00, flag: '🇺🇸', custom: false },
                    KWD: { symbol: 'د.ك', rate: 0.31, flag: '🇰🇼', custom: false }
                },
                _version: 1
            });
        } else {
            // Exist karta hai — update karo
            if (name !== undefined) config.name = name;
            if (currency !== undefined) config.currency = currency;
            if (wifi !== undefined) config.wifi = wifi;
            if (airportPrice !== undefined) config.airportPrice = airportPrice;
            if (localPrice !== undefined) config.localPrice = localPrice;
            if (currencies !== undefined) config.currencies = currencies;
            config._version = (config._version || 0) + 1;
            config.updatedAt = new Date();
        }

        await config.save();
        res.json(config);
    } catch (error) {
        console.error('PUT /config/hotel/:hotelId error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE config by id
router.delete('/:id', async (req, res) => {
    try {
        const config = await Config.findByIdAndDelete(req.params.id);
        if (!config) {
            return res.status(404).json({ error: 'Config not found' });
        }
        res.json({ success: true, message: 'Config deleted' });
    } catch (error) {
        console.error('DELETE /config/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;