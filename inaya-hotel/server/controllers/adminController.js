// server/controllers/adminController.js
// Complete Admin Controller - Native MongoDB Compatible
// Features: Login, Hotel Registration with Auto Admin User, CRUD Operations

const { getDB, isConnected } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

const DEFAULT_ADMIN_PERMISSIONS = [
    'rooms', 'guests', 'food', 'inventory', 'requests', 
    'settings', 'staff', 'bookings', 'reports', 'cab',
    'announcements', 'policies', 'departments', 'maintenance',
    'blacklist', 'reviews', 'logs'
];

// ============================================================
// HELPER: Generate JWT Token
// ============================================================
function generateToken(user, hotelId) {
    return jwt.sign(
        {
            id: user._id?.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            hotelId: hotelId,
            permissions: user.permissions
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

// ============================================================
// 🏨 HOTEL REGISTRATION + AUTO ADMIN USER CREATION
// ============================================================
exports.registerHotel = async (req, res) => {
    try {
        const {
            hotelId, hotelName, adminEmail, adminPassword,
            currency, currencySymbol, language, country,
            subscriptionType, theme, logo, timezone
        } = req.body;

        console.log('\n========================================');
        console.log('🔄 NEW HOTEL REGISTRATION REQUEST');
        console.log('========================================');

        // ✅ Validation
        if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
            return res.status(400).json({
                success: false,
                error: 'hotelId, hotelName, adminEmail, and adminPassword are required'
            });
        }

        if (adminPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Admin password must be at least 8 characters'
            });
        }

        const db = getDB();
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }

        // ✅ Check duplicate hotel
        const existingHotel = await db.collection('tenants').findOne({ hotelId });
        if (existingHotel) {
            return res.status(400).json({
                success: false,
                error: 'Hotel ID already registered'
            });
        }

        // ✅ Check duplicate admin email (globally)
        const existingUser = await db.collection('users').findOne({ 
            email: adminEmail.toLowerCase().trim() 
        });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: `Admin email ${adminEmail} already exists. Please use different email.`
            });
        }

        // ✅ Hash password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // ✅ Calculate subscription expiry
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

        // ✅ STEP 1: CREATE TENANT
        console.log('📝 Step 1: Creating tenant...');
        const tenant = {
            hotelId,
            hotelName,
            adminEmail: adminEmail.toLowerCase().trim(),
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

        // ✅ STEP 2: CREATE ADMIN USER (CRITICAL STEP)
        console.log('👤 Step 2: Creating admin user...');
        const adminUser = {
            email: adminEmail.toLowerCase().trim(),
            password: hashedPassword,
            name: 'Hotel Admin',
            role: 'admin',
            hotelId,
            permissions: DEFAULT_ADMIN_PERMISSIONS,
            active: true,
            status: 'active',
            loginCount: 0,
            lastLogin: null,
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        try {
            const userResult = await db.collection('users').insertOne(adminUser);
            console.log('✅✅✅ ADMIN USER CREATED ✅✅✅');
            console.log('   User ID:', userResult.insertedId);
            console.log('   Email:', adminEmail);
            console.log('   HotelId:', hotelId);
        } catch (userError) {
            console.error('❌❌❌ FAILED TO CREATE ADMIN USER ❌❌❌');
            console.error('Error:', userError.message);

            // Rollback tenant creation
            await db.collection('tenants').deleteOne({ hotelId });
            console.log('✅ Rolled back tenant creation');

            return res.status(500).json({
                success: false,
                error: 'Failed to create admin user: ' + userError.message
            });
        }

        // ✅ STEP 3: VERIFY USER WAS CREATED
        const verifyUser = await db.collection('users').findOne({
            email: adminEmail.toLowerCase().trim(),
            hotelId: hotelId
        });

        if (!verifyUser) {
            console.error('❌ User verification FAILED!');
            return res.status(500).json({
                success: false,
                error: 'User creation failed verification'
            });
        }
        console.log('✅ User verification successful');

        // ✅ STEP 4: CREATE DEFAULT CONFIG
        console.log('⚙️ Step 3: Creating config...');
        try {
            await db.collection('config').insertOne({
                hotelId,
                name: hotelName,
                currency: currency || 'USD',
                currencySymbol: currencySymbol || '$',
                wifi: `${hotelName.replace(/\s+/g, '_')}_Guest`,
                wifiPassword: 'Welcome123',
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

        console.log('✅✅✅ HOTEL REGISTRATION COMPLETE ✅✅✅\n');

        // ✅ RETURN RESPONSE
        res.status(201).json({
            success: true,
            message: 'Hotel registered successfully with admin user',
            data: {
                hotelId,
                hotelName,
                adminEmail: adminEmail.toLowerCase().trim(),
                adminPassword, // Plain text for display only
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
        console.error('❌❌❌ REGISTRATION FAILED ❌❌❌');
        console.error('Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Hotel registration failed: ' + error.message
        });
    }
};

// ============================================================
// 🔐 ADMIN LOGIN CONTROLLER
// ============================================================
exports.adminLogin = async (req, res) => {
    try {
        const { email, password, hotelId } = req.body;

        // ✅ Validation
        if (!email || !password || !hotelId) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and hotelId are required'
            });
        }

        const db = getDB();
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database not connected' });
        }

        console.log(`🔐 Login attempt: ${email} for hotel: ${hotelId}`);

        // ✅ STEP 1: Verify hotel exists and is active
        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            console.log(`❌ Hotel not found: ${hotelId}`);
            return res.status(404).json({
                success: false,
                error: 'Hotel not found. Please check Hotel ID.'
            });
        }

        if (tenant.active === false) {
            console.log(`❌ Hotel is inactive: ${hotelId}`);
            return res.status(403).json({
                success: false,
                error: 'Hotel account is inactive. Please contact support.'
            });
        }

        // ✅ STEP 2: STRICT hotelId match
        const normalizedEmail = email.toLowerCase().trim();
        const user = await db.collection('users').findOne({
            email: normalizedEmail,
            hotelId: hotelId,
            isDeleted: { $ne: true }
        });

        if (!user) {
            console.log(`❌ User not found for hotel ${hotelId}: ${normalizedEmail}`);

            // Helpful debug info
            const userAnyHotel = await db.collection('users').findOne({ 
                email: normalizedEmail,
                isDeleted: { $ne: true }
            });

            if (userAnyHotel) {
                console.log(`⚠️ User exists but belongs to different hotel: ${userAnyHotel.hotelId}`);
                return res.status(403).json({
                    success: false,
                    error: `This account belongs to hotel ${userAnyHotel.hotelId}, not ${hotelId}`
                });
            }

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials for this hotel'
            });
        }

        // ✅ STEP 3: Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log(`❌ Wrong password for: ${normalizedEmail}`);
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }

        // ✅ STEP 4: Check if user is active
        if (user.active === false) {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive. Please contact administrator.'
            });
        }

        // ✅ STEP 5: Update last login
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { lastLogin: new Date(), updatedAt: new Date() },
                $inc: { loginCount: 1 }
            }
        );

        // ✅ STEP 6: Generate token
        const token = generateToken(user, hotelId);

        console.log(`✅ Login successful for hotel ${hotelId}: ${normalizedEmail}`);

        // ✅ STEP 7: Return response
        res.json({
            success: true,
            token,
            user: {
                email: user.email,
                name: user.name,
                role: user.role,
                hotelId: hotelId,
                permissions: user.permissions
            },
            hotelId: hotelId,
            hotelName: tenant.hotelName
        });

    } catch (err) {
        console.error('❌ Login error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ============================================================
// 🏨 HOTEL SETTINGS CONTROLLER
// ============================================================
exports.getHotelSettings = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: true, data: null });

        const hotel = await db.collection('tenants').findOne({ hotelId: req.hotelId });
        if (hotel && hotel._id) hotel._id = hotel._id.toString();
        res.json({ success: true, data: hotel });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateHotelSettings = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId: req.hotelId },
            { $set: { ...req.body, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ success: false, error: 'Hotel not found' });
        if (result._id) result._id = result._id.toString();

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ============================================================
// 🏢 ROOM CONTROLLER
// ============================================================
exports.getRooms = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: true, data: [] });

        const rooms = await db.collection('rooms')
            .find({ hotelId: req.hotelId, isDeleted: { $ne: true } })
            .sort({ number: 1 })
            .toArray();
        rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
        res.json({ success: true, data: rooms });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.createRoom = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const room = {
            ...req.body,
            hotelId: req.hotelId,
            number: parseInt(req.body.number),
            createdAt: new Date(),
            updatedAt: new Date(),
            _version: 1,
            isDeleted: false
        };

        const result = await db.collection('rooms').insertOne(room);
        room._id = result.insertedId.toString();
        res.status(201).json({ success: true, data: room });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.updateRoom = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const roomId = req.params.id;
        const filter = ObjectId.isValid(roomId)
            ? { _id: new ObjectId(roomId), hotelId: req.hotelId }
            : { _id: roomId, hotelId: req.hotelId };

        const result = await db.collection('rooms').findOneAndUpdate(
            filter,
            { $set: { ...req.body, updatedAt: new Date() }, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ success: false, error: 'Room not found' });
        if (result._id) result._id = result._id.toString();

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteRoom = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const roomId = req.params.id;
        const filter = ObjectId.isValid(roomId)
            ? { _id: new ObjectId(roomId), hotelId: req.hotelId }
            : { _id: roomId, hotelId: req.hotelId };

        // Soft delete
        await db.collection('rooms').findOneAndUpdate(
            filter,
            { $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() } }
        );
        res.json({ success: true, message: 'Room deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ============================================================
// 🍽️ FOOD MENU CONTROLLER
// ============================================================
exports.getFoodItems = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: true, data: [] });

        const items = await db.collection('food')
            .find({ hotelId: req.hotelId, isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();
        items.forEach(i => { if (i._id) i._id = i._id.toString(); });
        res.json({ success: true, data: items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.createFoodItem = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const item = {
            ...req.body,
            hotelId: req.hotelId,
            price: parseFloat(req.body.price),
            createdAt: new Date(),
            updatedAt: new Date(),
            _version: 1,
            isDeleted: false
        };

        const result = await db.collection('food').insertOne(item);
        item._id = result.insertedId.toString();
        res.status(201).json({ success: true, data: item });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.updateFoodItem = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const itemId = req.params.id;
        const filter = ObjectId.isValid(itemId)
            ? { _id: new ObjectId(itemId), hotelId: req.hotelId }
            : { _id: itemId, hotelId: req.hotelId };

        const result = await db.collection('food').findOneAndUpdate(
            filter,
            { $set: { ...req.body, updatedAt: new Date() }, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ success: false, error: 'Food item not found' });
        if (result._id) result._id = result._id.toString();

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteFoodItem = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const itemId = req.params.id;
        const filter = ObjectId.isValid(itemId)
            ? { _id: new ObjectId(itemId), hotelId: req.hotelId }
            : { _id: itemId, hotelId: req.hotelId };

        // Soft delete
        await db.collection('food').findOneAndUpdate(
            filter,
            { $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() } }
        );
        res.json({ success: true, message: 'Food item deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ============================================================
// 👤 ADMIN USER MANAGEMENT
// ============================================================
exports.getAdminUsers = async (req, res) => {
    try {
        const db = getDB();
        if (!db) return res.json({ success: true, data: [] });

        const users = await db.collection('users')
            .find({ hotelId: req.hotelId, isDeleted: { $ne: true } })
            .toArray();

        users.forEach(u => {
            if (u._id) u._id = u._id.toString();
            delete u.password; // Never send password
        });

        res.json({ success: true, data: users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.createAdminUser = async (req, res) => {
    try {
        const { email, password, name, role, permissions } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        // Check duplicate
        const existing = await db.collection('users').findOne({
            email: email.toLowerCase().trim(),
            hotelId: req.hotelId
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'User with this email already exists for this hotel'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = {
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            name: name || email.split('@')[0],
            role: role || 'staff',
            hotelId: req.hotelId,
            permissions: permissions || DEFAULT_ADMIN_PERMISSIONS,
            active: true,
            status: 'active',
            loginCount: 0,
            lastLogin: null,
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('users').insertOne(user);
        user._id = result.insertedId.toString();
        delete user.password;

        res.status(201).json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateAdminUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const updates = { ...req.body };

        // Hash new password if provided
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }

        // Never allow changing email to another user's email
        delete updates.email;
        delete updates.hotelId;
        delete updates._id;

        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const filter = ObjectId.isValid(userId)
            ? { _id: new ObjectId(userId), hotelId: req.hotelId }
            : { _id: userId, hotelId: req.hotelId };

        const result = await db.collection('users').findOneAndUpdate(
            filter,
            { $set: { ...updates, updatedAt: new Date() }, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ success: false, error: 'User not found' });
        if (result._id) result._id = result._id.toString();
        delete result.password;

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteAdminUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const filter = ObjectId.isValid(userId)
            ? { _id: new ObjectId(userId), hotelId: req.hotelId }
            : { _id: userId, hotelId: req.hotelId };

        await db.collection('users').findOneAndUpdate(
            filter,
            { $set: { isDeleted: true, deletedAt: new Date(), active: false } }
        );

        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ============================================================
// 🔑 CHANGE PASSWORD
// ============================================================
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user?.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current and new password are required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        const db = getDB();
        if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const validCurrent = await bcrypt.compare(currentPassword, user.password);
        if (!validCurrent) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }

        const hashedNew = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { password: hashedNew, updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};