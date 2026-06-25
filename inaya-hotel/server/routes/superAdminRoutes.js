const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ======================== DATABASE CONNECTION ========================
const getDb = () => {
    // Assuming db is set in app
    return require('../server').db;
};

// ======================== MIDDLEWARE ========================
const superAdminMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-key-change-in-production');
        if (decoded.role !== 'super_admin') {
            return res.status(403).json({ success: false, error: 'Super admin access required' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

// ======================== ROUTES ========================

// ✅ HOTEL REGISTER (with admin user creation)
router.post('/tenants/register', async (req, res) => {
    try {
        const {
            hotelId, hotelName, adminEmail, adminPassword,
            currency, currencySymbol, language, country,
            subscriptionType, theme, logo, timezone
        } = req.body;

        if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
            return res.status(400).json({ success: false, error: 'hotelId, hotelName, adminEmail, and adminPassword are required' });
        }

        const db = req.app.get('db');
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        // Check if hotel already exists
        const existing = await db.collection('tenants').findOne({ hotelId });
        if (existing) return res.status(400).json({ success: false, error: 'Hotel ID already registered' });

        // Hash password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Calculate subscription expiry
        let subscriptionExpiry;
        if (subscriptionType === 'lifetime') subscriptionExpiry = null;
        else if (subscriptionType === 'enterprise') subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        else if (subscriptionType === 'pro') subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        else subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // 1️⃣ CREATE TENANT
        const tenant = {
            hotelId, hotelName, logo: logo || null,
            currency: currency || 'USD', currencySymbol: currencySymbol || '$',
            language: language || 'en', country: country || 'Unknown',
            timezone: timezone || 'UTC', active: true,
            theme: theme || 'HOTEL001', subscriptionType: subscriptionType || 'basic',
            subscriptionExpiry, createdAt: new Date(), updatedAt: new Date()
        };
        await db.collection('tenants').insertOne(tenant);
        console.log('✅ Tenant created:', hotelId);

        // 2️⃣ CREATE ADMIN USER
        const adminUser = {
            email: adminEmail,
            password: hashedPassword,
            name: 'Hotel Admin',
            role: 'admin',
            hotelId,
            permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
            active: true,
            createdAt: new Date()
        };
        await db.collection('users').insertOne(adminUser);
        console.log('✅ Admin user created:', adminEmail);

        // 3️⃣ CREATE CONFIG
        await db.collection('config').insertOne({
            hotelId,
            name: hotelName,
            currency: currency || 'SAR',
            currencySymbol: currencySymbol || '﷼',
            wifi: `${hotelName.replace(/\s+/g, '_')}_Guest`,
            airportPrice: 115,
            localPrice: 60,
            language: language || 'en',
            theme: { primaryColor: '#667eea' },
            updatedAt: new Date()
        });
        console.log('✅ Config created for:', hotelId);

        // ✅ RETURN WITH EMAIL & PASSWORD
        res.status(201).json({
            success: true,
            message: 'Hotel registered successfully',
            data: {
                hotelId,
                hotelName,
                adminEmail,      // ✅ Email show karega
                adminPassword,   // ✅ Password show karega
                currency,
                country,
                subscriptionType,
                expiryDate: subscriptionExpiry
            }
        });
    } catch (error) {
        console.error('Hotel registration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ LIST HOTELS
router.get('/tenants', async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) return res.json({ success: true, data: [], count: 0 });

        const { active, subscriptionType, country } = req.query;
        let filter = {};
        if (active !== undefined) filter.active = active === 'true';
        if (subscriptionType) filter.subscriptionType = subscriptionType;
        if (country) filter.country = country;

        const tenants = await db.collection('tenants').find(filter).sort({ createdAt: -1 }).toArray();

        const tenantsWithStats = await Promise.all(tenants.map(async (t) => {
            const [rooms, guests, requests, bookings] = await Promise.all([
                db.collection('rooms').countDocuments({ hotelId: t.hotelId }),
                db.collection('guests').countDocuments({ hotelId: t.hotelId }),
                db.collection('requests').countDocuments({ hotelId: t.hotelId, status: 'open' }),
                db.collection('bookings').countDocuments({ hotelId: t.hotelId })
            ]);
            return { ...t, stats: { rooms, guests, openRequests: requests, totalBookings: bookings } };
        }));

        res.json({ success: true, data: tenantsWithStats, count: tenantsWithStats.length });
    } catch (error) {
        console.error('List tenants error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ UPDATE HOTEL
router.put('/tenants/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const updates = req.body;
        const db = req.app.get('db');
        if (!db) return res.json({ success: true, message: 'Hotel updated (offline mode)' });

        const result = await db.collection('tenants').updateOne(
            { hotelId },
            { $set: { ...updates, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Hotel not found' });

        // Invalidate subscription cache
        // broadcast(hotelId, 'cfg_upd', { hotelName: updates.hotelName, currency: updates.currency }, req.clientId);

        res.json({ success: true, message: 'Hotel updated' });
    } catch (error) {
        console.error('Update tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ DELETE HOTEL
router.delete('/tenants/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const db = req.app.get('db');
        if (!db) return res.json({ success: true, message: 'Hotel deleted (offline mode)' });

        await Promise.all([
            db.collection('rooms').deleteMany({ hotelId }),
            db.collection('guests').deleteMany({ hotelId }),
            db.collection('food').deleteMany({ hotelId }),
            db.collection('inventory').deleteMany({ hotelId }),
            db.collection('requests').deleteMany({ hotelId }),
            db.collection('bookings').deleteMany({ hotelId }),
            db.collection('staff').deleteMany({ hotelId }),
            db.collection('logs').deleteMany({ hotelId }),
            db.collection('sessions').deleteMany({ hotelId }),
            db.collection('config').deleteOne({ hotelId }),
            db.collection('users').deleteMany({ hotelId }),
            db.collection('announcements').deleteMany({ hotelId }),
            db.collection('policies').deleteMany({ hotelId }),
            db.collection('departments').deleteMany({ hotelId })
        ]);

        await db.collection('tenants').deleteOne({ hotelId });

        // io.to(`hotel_${hotelId}`).emit('hotel_deleted', { message: 'This hotel has been deactivated' });

        res.json({ success: true, message: 'Hotel and all data deleted' });
    } catch (error) {
        console.error('Delete tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET COUNTRIES
router.get('/countries', async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) return res.json({ success: true, data: [] });
        const countries = await db.collection('tenants').aggregate([
            { $group: { _id: '$country', count: { $sum: 1 }, activeCount: { $sum: { $cond: ['$active', 1, 0] } } } },
            { $sort: { count: -1 } }
        ]).toArray();
        res.json({ success: true, data: countries });
    } catch (error) {
        console.error('Countries fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ REGISTER ADMIN
router.post('/admins/register', async (req, res) => {
    try {
        const { email, password, name, hotelId, role, permissions } = req.body;
        if (!email || !password || !hotelId) return res.status(400).json({ success: false, error: 'email, password, and hotelId are required' });

        const db = req.app.get('db');
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const existing = await db.collection('users').findOne({ email, hotelId });
        if (existing) return res.status(400).json({ success: false, error: 'User already exists for this hotel' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            email, password: hashedPassword,
            name: name || email.split('@')[0],
            role: role || 'admin', hotelId,
            permissions: permissions || ['rooms', 'guests', 'food', 'inventory', 'requests'],
            active: true, createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(user);
        user._id = result.insertedId;
        delete user.password;
        res.status(201).json({ success: true, message: 'Admin created', data: user });
    } catch (error) {
        console.error('Admin register error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET STATS
router.get('/stats', async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) {
            return res.json({ success: true, data: { totalHotels: 0, totalRevenue: 0, activeSubscriptions: 0, totalGuests: 0, hotelsGrowth: 0, revenueGrowth: 0, churnRate: 0, guestsGrowth: 0 } });
        }

        const tenants = await db.collection('tenants').find({}).toArray();
        const totalHotels = tenants.length;
        const activeTenants = tenants.filter(t => t.active !== false);
        const activeSubscriptions = activeTenants.length;

        let totalRevenue = 0;
        tenants.forEach(t => {
            const plan = (t.subscriptionType || '').toLowerCase();
            if (plan === 'enterprise') totalRevenue += 499;
            else if (plan === 'pro') totalRevenue += 99;
        });

        const guestsAgg = await db.collection('guests').aggregate([
            { $group: { _id: null, total: { $sum: 1 } } }
        ]).toArray();
        const totalGuests = guestsAgg[0]?.total || 0;

        const now = new Date();
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const lastMonthTenants = tenants.filter(t => t.createdAt && new Date(t.createdAt) < lastMonth);
        const hotelsGrowth = lastMonthTenants.length > 0
            ? Math.round(((totalHotels - lastMonthTenants.length) / lastMonthTenants.length) * 100)
            : (totalHotels > 0 ? 100 : 0);

        const inactiveTenants = tenants.filter(t => t.active === false);
        const churnRate = totalHotels > 0 ? Math.round((inactiveTenants.length / totalHotels) * 100) : 0;

        res.json({ success: true, data: { totalHotels, totalRevenue, activeSubscriptions, totalGuests, hotelsGrowth, revenueGrowth: 8, churnRate, guestsGrowth: 12 } });
    } catch (error) {
        console.error('Super stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET TRANSACTIONS
router.get('/transactions', async (req, res) => {
    try {
        const db = req.app.get('db');
        if (!db) return res.json({ success: true, data: [] });

        const tenants = await db.collection('tenants').find({}).toArray();
        const transactions = tenants
            .filter(t => t.subscriptionType && t.createdAt)
            .map(t => {
                const plan = (t.subscriptionType || '').toLowerCase();
                let amount = 0, type = 'subscription';
                if (plan === 'enterprise') amount = 499;
                else if (plan === 'pro') amount = 99;
                else { amount = 0; type = 'trial'; }

                return {
                    _id: t._id?.toString() || `tx_${t.hotelId}`,
                    hotelId: t.hotelId, hotelName: t.hotelName || t.hotelId,
                    type, amount, currency: t.currency || 'USD',
                    date: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
                    status: t.active !== false ? 'completed' : 'cancelled',
                    subscriptionType: t.subscriptionType,
                    expiryDate: t.subscriptionExpiry ? new Date(t.subscriptionExpiry).toISOString() : null
                };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ success: true, data: transactions, count: transactions.length });
    } catch (error) {
        console.error('Super transactions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;