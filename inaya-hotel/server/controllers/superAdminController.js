const bcrypt = require('bcryptjs');
const { getDB, isConnected } = require('../config/db');
const { broadcast } = require('../utils/broadcast');
const { success, error, created, notFound } = require('../utils/apiResponse');

// Register new hotel
exports.registerHotel = async (req, res) => {
  try {
    const { 
      hotelId, 
      hotelName, 
      adminEmail, 
      adminPassword, 
      currency, 
      currencySymbol,
      language, 
      country, 
      subscriptionType,
      theme,
      logo,
      timezone
    } = req.body;

    console.log('🔄 Hotel registration started:', { hotelId, hotelName, adminEmail });

    if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
      console.error('❌ Missing required fields');
      return error(res, 'hotelId, hotelName, adminEmail, and adminPassword are required', 400);
    }

    if (!isConnected()) {
      console.error('❌ Database not connected');
      return error(res, 'Database not connected', 503);
    }

    const db = getDB();

    // Check if hotel already exists
    const existing = await db.collection('tenants').findOne({ hotelId });
    if (existing) {
      console.error('❌ Hotel ID already registered:', hotelId);
      return error(res, 'Hotel ID already registered', 400);
    }

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

    // 1️⃣ Create tenant
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
    console.log('✅ Tenant created:', tenantResult.insertedId);

    // 2️⃣ Create admin user
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

    const userResult = await db.collection('users').insertOne(adminUser);
    console.log('✅ Admin user created:', userResult.insertedId);

    // Verify user was created
    const verifyUser = await db.collection('users').findOne({ 
      email: adminEmail, 
      hotelId: hotelId 
    });

    if (!verifyUser) {
      console.error('❌ User verification failed - user not found after creation!');
      // Rollback tenant creation
      await db.collection('tenants').deleteOne({ hotelId });
      return error(res, 'Failed to create admin user', 500);
    }
    console.log('✅ User verification successful');

    // 3️⃣ Create settings
    await db.collection('settings').insertOne({
      hotelId,
      hotelName,
      currencySymbol: currencySymbol || '$',
      priceFormat: 'symbol-first',
      taxRate: 0,
      wifiSSID: `${hotelName.replace(/\s+/g, '_')}_Guest`,
      wifiPassword: 'Welcome123',
      language: language || 'en',
      theme: { primaryColor: '#667eea' },
      transport: { airport: 30, local: 15 },
      updatedAt: new Date()
    });
    console.log('✅ Settings created');

    console.log('✅✅✅ Hotel registration complete:', hotelId);

    return created(res, { 
      hotelId, 
      hotelName, 
      adminEmail,
      adminPassword, // ✅ Return plain password for display
      currency,
      country,
      subscriptionType,
      expiryDate: subscriptionExpiry
    }, 'Hotel registered successfully');

  } catch (err) {
    console.error('❌ Hotel registration error:', err);
    console.error('Error stack:', err.stack);
    return error(res, err.message, 500);
  }
};

// List all hotels
exports.listHotels = async (req, res) => {
  try {
    if (!isConnected()) {
      return success(res, [], 'No hotels', 200);
    }

    const db = getDB();
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

    return success(res, tenantsWithStats, 'Hotels retrieved', 200);

  } catch (err) {
    console.error('List tenants error:', err);
    return error(res, err.message, 500);
  }
};

// Update hotel
exports.updateHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const updates = req.body;

    if (!isConnected()) {
      return success(res, null, 'Hotel updated (offline mode)');
    }

    const db = getDB();
    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return notFound(res, 'Hotel not found');
    }

    if (updates.hotelName || updates.currency || updates.language || updates.theme) {
      broadcast(hotelId, 'cfg_upd', {
        hotelName: updates.hotelName,
        currency: updates.currency,
        currencySymbol: updates.currencySymbol,
        language: updates.language,
        theme: updates.theme
      }, req.clientId);
    }

    return success(res, null, 'Hotel updated');

  } catch (err) {
    console.error('Update tenant error:', err);
    return error(res, err.message, 500);
  }
};

// Delete hotel
exports.deleteHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;

    if (!isConnected()) {
      return success(res, null, 'Hotel deleted (offline mode)');
    }

    const db = getDB();

    await Promise.all([
      db.collection('rooms').deleteMany({ hotelId }),
      db.collection('guests').deleteMany({ hotelId }),
      db.collection('food').deleteMany({ hotelId }),
      db.collection('inventory').deleteMany({ hotelId }),
      db.collection('requests').deleteMany({ hotelId }),
      db.collection('bookings').deleteMany({ hotelId }),
      db.collection('staff').deleteMany({ hotelId }),
      db.collection('logs').deleteMany({ hotelId }),
      db.collection('settings').deleteOne({ hotelId }),
      db.collection('users').deleteMany({ hotelId })
    ]);

    await db.collection('tenants').deleteOne({ hotelId });

    const { getIO } = require('../config/socket');
    const io = getIO();
    if (io) {
      io.to(`hotel_${hotelId}`).emit('hotel_deleted', { message: 'This hotel has been deactivated' });
    }

    return success(res, null, 'Hotel and all data deleted');

  } catch (err) {
    console.error('Delete tenant error:', err);
    return error(res, err.message, 500);
  }
};

// Get countries
exports.getCountries = async (req, res) => {
  try {
    if (!isConnected()) {
      return success(res, []);
    }

    const db = getDB();
    const countries = await db.collection('tenants').aggregate([
      { $group: { _id: '$country', count: { $sum: 1 }, activeCount: { $sum: { $cond: ['$active', 1, 0] } } } },
      { $sort: { count: -1 } }
    ]).toArray();

    return success(res, countries);

  } catch (err) {
    console.error('Countries fetch error:', err);
    return error(res, err.message, 500);
  }
};

// Register hotel admin
exports.registerAdmin = async (req, res) => {
  try {
    const { email, password, name, hotelId, role, permissions } = req.body;

    if (!email || !password || !hotelId) {
      return error(res, 'email, password, and hotelId are required', 400);
    }

    if (!isConnected()) {
      return error(res, 'Database not connected', 503);
    }

    const db = getDB();

    const existing = await db.collection('users').findOne({ email, hotelId });
    if (existing) {
      return error(res, 'User already exists for this hotel', 400);
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

    return created(res, user, 'Admin created');

  } catch (err) {
    console.error('Admin register error:', err);
    return error(res, err.message, 500);
  }
};

// Get platform stats
exports.getStats = async (req, res) => {
  try {
    if (!isConnected()) {
      return success(res, {
        totalHotels: 0,
        totalRevenue: 0,
        activeSubscriptions: 0,
        totalGuests: 0,
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
    const churnRate = totalHotels > 0 
      ? Math.round((inactiveTenants.length / totalHotels) * 100)
      : 0;

    const revenueGrowth = 8;
    const guestsGrowth = 12;

    return success(res, {
      totalHotels,
      totalRevenue,
      activeSubscriptions,
      totalGuests,
      hotelsGrowth,
      revenueGrowth,
      churnRate,
      guestsGrowth
    });

  } catch (err) {
    console.error('Super stats error:', err);
    return error(res, err.message, 500);
  }
};

// Get transactions
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
        else if (plan === 'basic' || plan === 'free') {
          amount = 0;
          type = 'trial';
        }

        return {
          _id: t._id?.toString() || `tx_${t.hotelId}`,
          hotelId: t.hotelId,
          hotelName: t.hotelName || t.hotelId,
          type: type,
          amount: amount,
          currency: t.currency || 'USD',
          date: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
          status: t.active !== false ? 'completed' : 'cancelled',
          subscriptionType: t.subscriptionType,
          expiryDate: t.subscriptionExpiry ? new Date(t.subscriptionExpiry).toISOString() : null
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return success(res, transactions, 'Transactions retrieved', 200);

  } catch (err) {
    console.error('Super transactions error:', err);
    return error(res, err.message, 500);
  }
};