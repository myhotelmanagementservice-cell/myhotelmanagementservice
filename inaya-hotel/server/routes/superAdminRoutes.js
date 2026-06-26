const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ======================== DATABASE CONNECTION ========================
const getDb = (req) => {
    const db = req.app.get('db') || req.app.locals.db || global.db;
    if (!db) console.error('❌ Database not found in app');
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

router.use(superAdminMiddleware);

// ======================== HOTEL REGISTER - FIXED VERSION ========================
router.post('/tenants/register', async (req, res) => {
    console.log('\n========================================');
    console.log('🔄 NEW HOTEL REGISTRATION REQUEST');
    console.log('========================================');
    console.log('📦 Request body keys:', Object.keys(req.body));
    console.log('📧 adminEmail received:', req.body.adminEmail || '❌ MISSING');
    console.log('🔑 adminPassword received:', req.body.adminPassword ? '✅ RECEIVED' : '❌ MISSING');
    console.log('🏨 hotelId:', req.body.hotelId);

    const db = getDb(req);
    if (!db) {
        return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    try {
        const {
            hotelId, hotelName, adminEmail, adminPassword,
            currency, currencySymbol, language, country,
            subscriptionType, theme, logo, timezone
        } = req.body;

        // ✅ STRICT VALIDATION
        if (!hotelId || !hotelName) {
            return res.status(400).json({ success: false, error: 'hotelId and hotelName are required' });
        }
        if (!adminEmail || !adminPassword) {
            console.error('❌ VALIDATION FAILED: adminEmail or adminPassword missing!');
            return res.status(400).json({ 
                success: false, 
                error: 'Admin email and password are required. Please fill all fields.' 
            });
        }

        // ✅ CHECK DUPLICATE HOTEL
        const existingHotel = await db.collection('tenants').findOne({ hotelId });
        if (existingHotel) {
            return res.status(400).json({ success: false, error: 'Hotel ID already registered' });
        }

        // ✅ HASH PASSWORD
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // ✅ CALCULATE EXPIRY
        let subscriptionExpiry;
        if (subscriptionType === 'lifetime') subscriptionExpiry = null;
        else if (subscriptionType === 'enterprise') subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        else if (subscriptionType === 'pro') subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        else subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // ✅ STEP 1: CREATE TENANT
        console.log('📝 Step 1: Creating tenant...');
        const tenant = {
            hotelId,
            hotelName,
            adminEmail,           // ✅ Save email in tenant too
            adminPassword,        // ✅ Save plain password for reference (optional)
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
        console.log('✅ Tenant created:', tenantResult.insertedId);

        // ✅ STEP 2: CREATE ADMIN USER (with retry logic)
        console.log('👤 Step 2: Creating admin user...');
        console.log('   Email:', adminEmail);
        console.log('   HotelId:', hotelId);

        // First check if user with this email already exists
        const existingUserByEmail = await db.collection('users').findOne({ email: adminEmail });
        if (existingUserByEmail) {
            console.warn('⚠️ User with this email already exists:', adminEmail);
            console.warn('   Existing hotelId:', existingUserByEmail.hotelId);

            // If it belongs to same hotel, update it
            if (existingUserByEmail.hotelId === hotelId) {
                console.log('🔄 Updating existing user for same hotel...');
                await db.collection('users').updateOne(
                    { email: adminEmail },
                    { 
                        $set: { 
                            password: hashedPassword,
                            role: 'admin',
                            hotelId: hotelId,
                            active: true,
                            updatedAt: new Date()
                        } 
                    }
                );
                console.log('✅ User updated successfully');
            } else {
                // Different hotel - create with modified email
                console.log('🔄 Creating with modified email (hotelId suffix)...');
                const modifiedEmail = `${adminEmail.split('@')[0]}+${hotelId.toLowerCase()}@${adminEmail.split('@')[1]}`;

                const adminUser = {
                    email: modifiedEmail,
                    password: hashedPassword,
                    name: 'Hotel Admin',
                    role: 'admin',
                    hotelId,
                    permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
                    active: true,
                    createdAt: new Date()
                };

                const userResult = await db.collection('users').insertOne(adminUser);
                console.log('✅ User created with modified email:', modifiedEmail, 'ID:', userResult.insertedId);
            }
        } else {
            // No existing user - create new
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
                console.log('✅✅✅ ADMIN USER CREATED ✅✅✅');
                console.log('   User ID:', userResult.insertedId);
            } catch (userError) {
                console.error('❌ USER CREATION FAILED:', userError.message);

                // If duplicate key error, try with modified email
                if (userError.code === 11000) {
                    console.log('🔄 Duplicate key error - trying with modified email...');
                    const modifiedEmail = `${adminEmail.split('@')[0]}+${hotelId.toLowerCase()}@${adminEmail.split('@')[1]}`;

                    const adminUser2 = {
                        email: modifiedEmail,
                        password: hashedPassword,
                        name: 'Hotel Admin',
                        role: 'admin',
                        hotelId,
                        permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
                        active: true,
                        createdAt: new Date()
                    };

                    const userResult = await db.collection('users').insertOne(adminUser2);
                    console.log('✅ User created with modified email:', modifiedEmail);
                } else {
                    throw userError;
                }
            }
        }

        // ✅ STEP 3: CREATE CONFIG
        console.log('⚙️ Step 3: Creating config...');
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
            console.log('✅ Config created');
        } catch (configError) {
            console.warn('⚠️ Config creation failed (non-critical):', configError.message);
        }

        // ✅ VERIFY EVERYTHING
        console.log('\n🔍 VERIFICATION:');
        const verifyTenant = await db.collection('tenants').findOne({ hotelId });
        const verifyUser = await db.collection('users').findOne({ hotelId });
        console.log('   Tenant exists:', verifyTenant ? '✅' : '❌');
        console.log('   User exists:', verifyUser ? '✅' : '❌');
        console.log('   User email:', verifyUser?.email);
        console.log('========================================\n');

        res.status(201).json({
            success: true,
            message: 'Hotel registered successfully',
            data: {
                hotelId,
                hotelName,
                adminEmail: verifyUser?.email || adminEmail,
                adminPassword,
                currency,
                currencySymbol,
                country,
                language,
                subscriptionType,
                expiryDate: subscriptionExpiry,
                active: true
            }
        });

    } catch (error) {
        console.error('\n❌❌❌ REGISTRATION FAILED ❌❌❌');
        console.error('Error:', error.message);
        console.error('Code:', error.code);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: 'Hotel registration failed: ' + error.message 
        });
    }
});

// ... (baaki saare routes same rakhein - LIST, GET, UPDATE, TOGGLE, DELETE, COUNTRIES, ADMINS, STATS, TRANSACTIONS)
// Aapke existing code se copy kar lein - wo sab sahi hain

module.exports = router;