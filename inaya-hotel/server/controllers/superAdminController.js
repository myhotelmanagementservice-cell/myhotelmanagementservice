// server/controllers/superAdminController.js
// Super Admin Controller - Native MongoDB Compatible
// Features: Hotel Management, Admin Users, Stats, Transactions

const bcrypt = require('bcryptjs');
const { getDB, isConnected } = require('../config/db');
const { broadcast } = require('../utils/broadcast');
const { success, error, created, notFound } = require('../utils/apiResponse');

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_ADMIN_PERMISSIONS = [
    'rooms', 'guests', 'food', 'inventory', 'requests', 
    'settings', 'staff', 'bookings', 'reports', 'cab',
    'announcements', 'policies', 'departments', 'maintenance',
    'blacklist', 'reviews', 'logs'
];

const COLLECTIONS_TO_CLEANUP = [
    'rooms', 'guests', 'food', 'inventory', 'requests',
    'bookings', 'staff', 'logs', 'settings', 'users',
    'announcements', 'policies', 'departments', 'maintenance',
    'blacklist', 'reviews', 'history', 'config', 'cabs',
    'loyalty', 'reports'
];

// ============================================================
// 🏨 REGISTER NEW HOTEL + ADMIN USER
// ============================================================
exports.registerHotel = async (req, res) => {
    try {
        const {
            hotelId, hotelName, adminEmail, adminPassword,
            currency, currencySymbol, language, country,
            subscriptionType, theme, logo, timezone
        } = req.body;

        console.log('\n🔄 Hotel registration started:', { hotelId, hotelName, adminEmail });

        // ✅ Validation
        if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
            return error(res, 'hotelId, hotelName, adminEmail, and adminPassword are required', 400);
        }

        if (adminPassword.length < 8) {
            return error(res, 'Admin password must be at least 8 characters', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const normalizedEmail = adminEmail.toLowerCase().trim();

        // ✅ Check duplicate hotel
        const existingHotel = await db.collection('tenants').findOne({ hotelId });
        if (existingHotel) {
            return error(res, 'Hotel ID already registered', 400);
        }

        // ✅ Check duplicate admin email (globally)
        const existingUser = await db.collection('users').findOne({ 
            email: normalizedEmail 
        });
        if (existingUser) {
            return error(res, `Admin email ${normalizedEmail} already exists`, 400);
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

        // ✅ STEP 1: Create tenant
        const tenant = {
            hotelId,
            hotelName,
            adminEmail: normalizedEmail,
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

        // ✅ STEP 2: Create admin user
        const adminUser = {
            email: normalizedEmail,
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
            console.log('✅ Admin user created:', userResult.insertedId);
        } catch (userError) {
            console.error('❌ Failed to create admin user:', userError.message);
            // Rollback tenant
            await db.collection('tenants').deleteOne({ hotelId });
            return error(res, 'Failed to create admin user: ' + userError.message, 500);
        }

        // ✅ STEP 3: Verify user creation
        const verifyUser = await db.collection('users').findOne({
            email: normalizedEmail,
            hotelId
        });

        if (!verifyUser) {
            console.error('❌ User verification failed!');
            await db.collection('tenants').deleteOne({ hotelId });
            return error(res, 'User creation failed verification', 500);
        }

        // ✅ STEP 4: Create default config
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

        console.log('✅✅✅ Hotel registration complete:', hotelId, '\n');

        return created(res, {
            hotelId,
            hotelName,
            adminEmail: normalizedEmail,
            adminPassword, // Plain text for display
            currency,
            currencySymbol,
            country,
            language,
            subscriptionType,
            expiryDate: subscriptionExpiry,
            active: true
        }, 'Hotel registered successfully');

    } catch (err) {
        console.error('❌ Hotel registration error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 📋 LIST ALL HOTELS
// ============================================================
exports.listHotels = async (req, res) => {
    try {
        if (!isConnected()) {
            return success(res, []);
        }

        const db = getDB();
        const { active, subscriptionType, country } = req.query;
        const filter = {};

        if (active !== undefined) filter.active = active === 'true';
        if (subscriptionType) filter.subscriptionType = subscriptionType;
        if (country) filter.country = country;

        const tenants = await db.collection('tenants')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        const tenantsWithStats = await Promise.all(tenants.map(async (t) => {
            const [rooms, guests, requests, bookings, users] = await Promise.all([
                db.collection('rooms').countDocuments({ hotelId: t.hotelId, isDeleted: { $ne: true } }),
                db.collection('guests').countDocuments({ hotelId: t.hotelId, isDeleted: { $ne: true } }),
                db.collection('requests').countDocuments({ hotelId: t.hotelId, status: 'open', isDeleted: { $ne: true } }),
                db.collection('bookings').countDocuments({ hotelId: t.hotelId, isDeleted: { $ne: true } }),
                db.collection('users').countDocuments({ hotelId: t.hotelId, isDeleted: { $ne: true } })
            ]);

            return {
                ...t,
                _id: t._id?.toString(),
                stats: {
                    rooms,
                    guests,
                    openRequests: requests,
                    totalBookings: bookings,
                    adminUsers: users
                }
            };
        }));

        return success(res, tenantsWithStats);

    } catch (err) {
        console.error('❌ List hotels error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔄 UPDATE HOTEL
// ============================================================
exports.updateHotel = async (req, res) => {
    try {
        const { hotelId } = req.params;
        const updates = { ...req.body };

        // Prevent changing hotelId
        delete updates.hotelId;
        delete updates._id;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            {
                $set: { ...updates, updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return notFound(res, 'Hotel not found');
        }

        // Broadcast update
        if (updates.hotelName || updates.currency || updates.language || updates.theme || updates.active !== undefined) {
            broadcast(hotelId, 'cfg_upd', {
                hotelId,
                hotelName: updates.hotelName,
                currency: updates.currency,
                currencySymbol: updates.currencySymbol,
                language: updates.language,
                theme: updates.theme,
                active: updates.active,
                updatedAt: new Date()
            }, req.clientId);
        }

        if (result._id) result._id = result._id.toString();
        return success(res, result, 'Hotel updated');

    } catch (err) {
        console.error('❌ Update hotel error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🗑️ DELETE HOTEL (Complete Cleanup)
// ============================================================
exports.deleteHotel = async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        // Verify hotel exists
        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            return notFound(res, 'Hotel not found');
        }

        // Delete all related data
        const deletePromises = COLLECTIONS_TO_CLEANUP.map(collection =>
            db.collection(collection).deleteMany({ hotelId }).catch(err => {
                console.warn(`⚠️ Failed to delete from ${collection}:`, err.message);
                return { deletedCount: 0 };
            })
        );

        await Promise.all(deletePromises);

        // Delete tenant last
        await db.collection('tenants').deleteOne({ hotelId });

        // Broadcast deletion
        broadcast(hotelId, 'hotel_deleted', { hotelId }, req.clientId);

        // Notify via socket
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            if (io) {
                io.to(`hotel_${hotelId}`).emit('hotel_deleted', {
                    message: 'This hotel has been deactivated'
                });
            }
        } catch (socketErr) {
            console.warn('⚠️ Socket notification failed:', socketErr.message);
        }

        console.log(`✅ Hotel and all data deleted: ${hotelId}`);
        return success(res, null, 'Hotel and all data deleted');

    } catch (err) {
        console.error('❌ Delete hotel error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🌍 GET COUNTRIES
// ============================================================
exports.getCountries = async (req, res) => {
    try {
        if (!isConnected()) {
            return success(res, []);
        }

        const db = getDB();
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

        return success(res, countries);

    } catch (err) {
        console.error('❌ Countries fetch error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 👤 REGISTER HOTEL ADMIN
// ============================================================
exports.registerAdmin = async (req, res) => {
    try {
        const { email, password, name, hotelId, role, permissions } = req.body;

        if (!email || !password || !hotelId) {
            return error(res, 'email, password, and hotelId are required', 400);
        }

        if (password.length < 8) {
            return error(res, 'Password must be at least 8 characters', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const normalizedEmail = email.toLowerCase().trim();

        // Check duplicate
        const existing = await db.collection('users').findOne({
            email: normalizedEmail,
            hotelId
        });

        if (existing) {
            return error(res, 'User already exists for this hotel', 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = {
            email: normalizedEmail,
            password: hashedPassword,
            name: name || normalizedEmail.split('@')[0],
            role: role || 'admin',
            hotelId,
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

        return created(res, user, 'Admin created');

    } catch (err) {
        console.error('❌ Admin register error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 📊 GET PLATFORM STATS
// ============================================================
exports.getStats = async (req, res) => {
    try {
        if (!isConnected()) {
            return success(res, {
                totalHotels: 0,
                totalRevenue: 0,
                activeSubscriptions: 0,
                totalGuests: 0,
                totalRooms: 0,
                totalBookings: 0,
                hotelsGrowth: 0,
                revenueGrowth: 0,
                churnRate: 0,
                guestsGrowth: 0
            });
        }

        const db = getDB();

        const tenants = await db.collection('tenants').find({}).toArray();
        const totalHotels = tenants.length;
        const activeTenants = tenants.filter(t => t.active !== false);
        const activeSubscriptions = activeTenants.length;

        // Calculate revenue
        let totalRevenue = 0;
        tenants.forEach(t => {
            const plan = (t.subscriptionType || '').toLowerCase();
            if (plan === 'enterprise') totalRevenue += 499;
            else if (plan === 'pro') totalRevenue += 99;
            else if (plan === 'basic') totalRevenue += 29;
        });

        // Get totals from collections
        const [totalGuests, totalRooms, totalBookings] = await Promise.all([
            db.collection('guests').countDocuments({ isDeleted: { $ne: true } }),
            db.collection('rooms').countDocuments({ isDeleted: { $ne: true } }),
            db.collection('bookings').countDocuments({ isDeleted: { $ne: true } })
        ]);

        // Calculate growth
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

        return success(res, {
            totalHotels,
            totalRevenue,
            activeSubscriptions,
            totalGuests,
            totalRooms,
            totalBookings,
            hotelsGrowth,
            revenueGrowth: 8,
            churnRate,
            guestsGrowth: 12
        });

    } catch (err) {
        console.error('❌ Stats error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 💰 GET TRANSACTIONS
// ============================================================
exports.getTransactions = async (req, res) => {
    try {
        if (!isConnected()) {
            return success(res, []);
        }

        const db = getDB();
        const tenants = await db.collection('tenants').find({}).toArray();

        const transactions = tenants
            .filter(t => t.subscriptionType && t.createdAt)
            .map(t => {
                const plan = (t.subscriptionType || '').toLowerCase();
                let amount = 0;
                let type = 'subscription';

                if (plan === 'enterprise') amount = 499;
                else if (plan === 'pro') amount = 99;
                else if (plan === 'basic') amount = 29;
                else {
                    amount = 0;
                    type = 'trial';
                }

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

        return success(res, transactions);

    } catch (err) {
        console.error('❌ Transactions error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔄 TOGGLE HOTEL STATUS
// ============================================================
exports.toggleHotelStatus = async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const tenant = await db.collection('tenants').findOne({ hotelId });

        if (!tenant) {
            return notFound(res, 'Hotel not found');
        }

        const newStatus = !tenant.active;

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            {
                $set: { active: newStatus, updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        // Broadcast status change
        broadcast(hotelId, 'hotel_status', {
            hotelId,
            active: newStatus
        }, req.clientId);

        if (result._id) result._id = result._id.toString();
        return success(res, result, `Hotel ${newStatus ? 'activated' : 'deactivated'}`);

    } catch (err) {
        console.error('❌ Toggle status error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔍 GET HOTEL DETAILS
// ============================================================
exports.getHotelDetails = async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const tenant = await db.collection('tenants').findOne({ hotelId });

        if (!tenant) {
            return notFound(res, 'Hotel not found');
        }

        // Get stats
        const [rooms, guests, bookings, users] = await Promise.all([
            db.collection('rooms').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('guests').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('bookings').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('users').countDocuments({ hotelId, isDeleted: { $ne: true } })
        ]);

        if (tenant._id) tenant._id = tenant._id.toString();

        return success(res, {
            ...tenant,
            stats: { rooms, guests, bookings, adminUsers: users }
        });

    } catch (err) {
        console.error('❌ Get hotel details error:', err);
        return error(res, err.message, 500);
    }
};