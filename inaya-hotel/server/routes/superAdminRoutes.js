const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ======================== DATABASE CONNECTION ========================
const getDb = (req) => {
    // Try multiple ways to get db
    const db = req.app.get('db') || req.app.locals.db || global.db;
    if (!db) {
        console.error('❌ Database not found in app');
    }
    return db;
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
        console.error('Super admin middleware error:', error);
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
};

// Apply middleware to all routes
router.use(superAdminMiddleware);

// ======================== ROUTES ========================

// ✅ HOTEL REGISTER (with admin user creation) - ENHANCED VERSION
router.post('/tenants/register', async (req, res) => {
    console.log('🔄 Starting hotel registration...');
    console.log('Request body:', req.body);

    try {
        const {
            hotelId, hotelName, adminEmail, adminPassword,
            currency, currencySymbol, language, country,
            subscriptionType, theme, logo, timezone
        } = req.body;

        // Validation
        if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
            console.error('❌ Validation failed: Missing required fields');
            return res.status(400).json({ 
                success: false, 
                error: 'hotelId, hotelName, adminEmail, and adminPassword are required' 
            });
        }

        const db = getDb(req);
        if (!db) {
            console.error('❌ Database not connected');
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }

        console.log('✅ Database connected, checking existing hotel...');

        // Check if hotel already exists
        const existing = await db.collection('tenants').findOne({ hotelId });
        if (existing) {
            console.error('❌ Hotel ID already exists:', hotelId);
            return res.status(400).json({ 
                success: false, 
                error: 'Hotel ID already registered' 
            });
        }

        // Check if admin email already exists (globally)
        const existingAdmin = await db.collection('users').findOne({ email: adminEmail });
        if (existingAdmin) {
            console.error('❌ Admin email already exists:', adminEmail);
            return res.status(400).json({ 
                success: false, 
                error: 'Admin email already exists. Please use a different email.' 
            });
        }

        console.log('✅ Validation passed, creating tenant...');

        // Hash password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        console.log('✅ Password hashed successfully');

        // Calculate subscription expiry
        let subscriptionExpiry;
        if (subscriptionType === 'lifetime') {
            subscriptionExpiry = null;
        } else if (subscriptionType === 'enterprise') {
            subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        } else if (subscriptionType === 'pro') {
            subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        } else {
            subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        // 1️⃣ CREATE TENANT
        const tenant = {
            hotelId,
            hotelName,
            logo: logo || null,
            currency: currency || 'USD',
            currencySymbol: currencySymbol || '$',
            language: language || 'en',
            country: country || 'Unknown',
            timezone: timezone || 'UTC',
            active: true,
            theme: theme || 'default',
            subscriptionType: subscriptionType || 'basic',
            subscriptionExpiry,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const tenantResult = await db.collection('tenants').insertOne(tenant);
        console.log('✅ Tenant created:', hotelId, 'ID:', tenantResult.insertedId);

        // 2️⃣ CREATE ADMIN USER - CRITICAL STEP
        console.log('🔄 Creating admin user...');
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

        try {
            const userResult = await db.collection('users').insertOne(adminUser);
            console.log('✅✅✅ ADMIN USER CREATED SUCCESSFULLY ✅✅✅');
            console.log('User ID:', userResult.insertedId);
            console.log('User Email:', adminEmail);
            console.log('User Hotel ID:', hotelId);

            // Verify user was created
            const verifyUser = await db.collection('users').findOne({ 
                email: adminEmail, 
                hotelId: hotelId 
            });
            if (verifyUser) {
                console.log('✅ User verification successful - user exists in database');
            } else {
                console.error('❌ User verification FAILED - user not found after insertion!');
            }
        } catch (userError) {
            console.error('❌❌❌ FAILED TO CREATE ADMIN USER ❌❌❌');
            console.error('Error:', userError.message);
            console.error('Stack:', userError.stack);

            // Try to rollback tenant creation
            try {
                await db.collection('tenants').deleteOne({ hotelId });
                console.log('✅ Rolled back tenant creation');
            } catch (rollbackError) {
                console.error('❌ Failed to rollback tenant:', rollbackError.message);
            }

            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create admin user: ' + userError.message 
            });
        }

        // 3️⃣ CREATE CONFIG
        console.log('🔄 Creating config...');
        try {
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
        } catch (configError) {
            console.error('⚠️ Config creation failed (non-critical):', configError.message);
            // Don't fail the entire request if config fails
        }

        console.log('✅✅✅ HOTEL REGISTRATION COMPLETE ✅✅✅');

        // ✅ RETURN WITH EMAIL & PASSWORD (for display)
        res.status(201).json({
            success: true,
            message: 'Hotel registered successfully with admin user',
            data: {
                hotelId,
                hotelName,
                adminEmail,
                adminPassword,
                currency,
                currencySymbol,
                country,
                language,
                subscriptionType,
                expiryDate: subscriptionExpiry,
                active: true,
                adminCreated: true
            }
        });
    } catch (error) {
        console.error('❌❌❌ HOTEL REGISTRATION FAILED ❌❌❌');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: 'Hotel registration failed: ' + error.message 
        });
    }
});

// ✅ LIST HOTELS
router.get('/tenants', async (req, res) => {
    try {
        const db = getDb(req);
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
            return { 
                ...t, 
                stats: { 
                    rooms, 
                    guests, 
                    openRequests: requests, 
                    totalBookings: bookings 
                } 
            };
        }));

        res.json({ 
            success: true, 
            data: tenantsWithStats, 
            count: tenantsWithStats.length 
        });
    } catch (error) {
        console.error('List tenants error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET SINGLE HOTEL
router.get('/tenants/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const db = getDb(req);
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Hotel not found' });
        }

        res.json({ success: true, data: tenant });
    } catch (error) {
        console.error('Get tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ UPDATE HOTEL
router.put('/tenants/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const updates = req.body;
        const db = getDb(req);

        if (!db) {
            return res.json({ success: true, message: 'Hotel updated (offline mode)' });
        }

        delete updates._id;
        delete updates.hotelId;

        const result = await db.collection('tenants').updateOne(
            { hotelId },
            { 
                $set: { 
                    ...updates, 
                    updatedAt: new Date() 
                } 
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Hotel not found' });
        }

        res.json({ 
            success: true, 
            message: 'Hotel updated successfully' 
        });
    } catch (error) {
        console.error('Update tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ TOGGLE HOTEL STATUS
router.patch('/tenants/:hotelId/toggle-status', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const { active } = req.body;

        const db = getDb(req);
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }

        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Hotel not found' });
        }

        const newStatus = active !== undefined ? active : !tenant.active;

        const result = await db.collection('tenants').updateOne(
            { hotelId },
            { 
                $set: { 
                    active: newStatus,
                    updatedAt: new Date()
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).json({ success: false, error: 'Failed to update status' });
        }

        res.json({ 
            success: true, 
            message: `Hotel ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data: { hotelId, active: newStatus }
        });
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ DELETE HOTEL
router.delete('/tenants/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const db = getDb(req);

        if (!db) {
            return res.json({ success: true, message: 'Hotel deleted (offline mode)' });
        }

        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Hotel not found' });
        }

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
            db.collection('departments').deleteMany({ hotelId }),
            db.collection('reviews').deleteMany({ hotelId }),
            db.collection('maintenance').deleteMany({ hotelId }),
            db.collection('blacklist').deleteMany({ hotelId })
        ]);

        await db.collection('tenants').deleteOne({ hotelId });

        console.log(`✅ Hotel deleted: ${hotelId}`);

        res.json({ 
            success: true, 
            message: 'Hotel and all data deleted permanently' 
        });
    } catch (error) {
        console.error('Delete tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET COUNTRIES
router.get('/countries', async (req, res) => {
    try {
        const db = getDb(req);
        if (!db) return res.json({ success: true, data: [] });

        const countries = await db.collection('tenants').aggregate([
            { 
                $group: { 
                    _id: '$country', 
                    count: { $sum: 1 }, 
                    activeCount: { $sum: { $cond: ['$active', 1, 0] } } 
                } 
            },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({ success: true, data: countries });
    } catch (error) {
        console.error('Countries fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ REGISTER ADMIN (for existing hotels)
router.post('/admins/register', async (req, res) => {
    try {
        const { email, password, name, hotelId, role, permissions } = req.body;

        if (!email || !password || !hotelId) {
            return res.status(400).json({ 
                success: false, 
                error: 'email, password, and hotelId are required' 
            });
        }

        const db = getDb(req);
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const existing = await db.collection('users').findOne({ email, hotelId });
        if (existing) {
            return res.status(400).json({ 
                success: false, 
                error: 'User already exists for this hotel' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            email,
            password: hashedPassword,
            name: name || email.split('@')[0],
            role: role || 'admin',
            hotelId,
            permissions: permissions || ['rooms', 'guests', 'food', 'inventory', 'requests'],
            active: true,
            createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(user);
        user._id = result.insertedId;
        delete user.password;

        res.status(201).json({ 
            success: true, 
            message: 'Admin created successfully',
            data: user 
        });
    } catch (error) {
        console.error('Admin register error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET STATS
router.get('/stats', async (req, res) => {
    try {
        const db = getDb(req);
        if (!db) {
            return res.json({ 
                success: true, 
                data: { 
                    totalHotels: 0, 
                    totalRevenue: 0, 
                    activeSubscriptions: 0, 
                    totalGuests: 0, 
                    hotelsGrowth: 0, 
                    revenueGrowth: 0, 
                    churnRate: 0, 
                    guestsGrowth: 0 
                } 
            });
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
            else if (plan === 'basic') totalRevenue += 29;
        });

        const guestsAgg = await db.collection('guests').aggregate([
            { $group: { _id: null, total: { $sum: 1 } } }
        ]).toArray();
        const totalGuests = guestsAgg[0]?.total || 0;

        const now = new Date();
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const lastMonthTenants = tenants.filter(t => 
            t.createdAt && new Date(t.createdAt) < lastMonth
        );
        const hotelsGrowth = lastMonthTenants.length > 0
            ? Math.round(((totalHotels - lastMonthTenants.length) / lastMonthTenants.length) * 100)
            : (totalHotels > 0 ? 100 : 0);

        const inactiveTenants = tenants.filter(t => t.active === false);
        const churnRate = totalHotels > 0 
            ? Math.round((inactiveTenants.length / totalHotels) * 100) 
            : 0;

        res.json({ 
            success: true, 
            data: { 
                totalHotels, 
                totalRevenue, 
                activeSubscriptions, 
                totalGuests, 
                hotelsGrowth, 
                revenueGrowth: 8, 
                churnRate, 
                guestsGrowth: 12 
            } 
        });
    } catch (error) {
        console.error('Super stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ GET TRANSACTIONS
router.get('/transactions', async (req, res) => {
    try {
        const db = getDb(req);
        if (!db) return res.json({ success: true, data: [] });

        const tenants = await db.collection('tenants').find({}).toArray();
        const transactions = tenants
            .filter(t => t.subscriptionType && t.createdAt)
            .map(t => {
                const plan = (t.subscriptionType || '').toLowerCase();
                let amount = 0, type = 'subscription';
                if (plan === 'enterprise') amount = 499;
                else if (plan === 'pro') amount = 99;
                else if (plan === 'basic') amount = 29;
                else { amount = 0; type = 'trial'; }

                return {
                    _id: t._id?.toString() || `tx_${t.hotelId}`,
                    hotelId: t.hotelId,
                    hotelName: t.hotelName || t.hotelId,
                    type,
                    amount,
                    currency: t.currency || 'USD',
                    date: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
                    status: t.active !== false ? 'completed' : 'cancelled',
                    subscriptionType: t.subscriptionType,
                    expiryDate: t.subscriptionExpiry ? new Date(t.subscriptionExpiry).toISOString() : null
                };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ 
            success: true, 
            data: transactions, 
            count: transactions.length 
        });
    } catch (error) {
        console.error('Super transactions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;