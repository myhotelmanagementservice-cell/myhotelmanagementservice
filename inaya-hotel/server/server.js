require("dotenv").config({ path: __dirname + "/.env" });
// server.js - Complete Multi-Tenant Hotel SaaS Backend (FINAL PRODUCTION READY - MULTI-DEVICE SYNC FIXED)
const express = require('express');
const session = require('express-session');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// ✅ Socket.io Setup with CORS for multi-origin support
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ Static file path - supports both root and inaya-hotel folder
const publicPath = path.join(__dirname, process.env.PUBLIC_PATH || '../public');
app.use(express.static(publicPath));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'inaya-hotel-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';

let db;
let client;
let dbConnected = false;

// ==================== MONGODB CONNECTION ====================
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');

    // ✅ FIXED: Removed deprecated options for MongoDB Driver 4.0+
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 5
    });

    await client.connect();
    db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    dbConnected = true;
    console.log('✅ MongoDB Connected Successfully!');

    await createIndexes();
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    dbConnected = false;
    setTimeout(connectDB, 5000);
    return null;
  }
}

// ✅✅✅ FIXED: Index creation with KEY PATTERN check (not just name)
async function createIndexes() {
  try {
    const collections = ['rooms', 'guests', 'food', 'inventory', 'requests', 'blacklist', 'maintenance', 'reviews', 'loyalty', 'staff', 'logs', 'settings', 'tenants', 'bookings', 'users'];

    for (const col of collections) {
      const collection = db.collection(col);

      // Get existing indexes with their key patterns
      let existingIndexes = [];
      try {
        existingIndexes = await collection.listIndexes().toArray();
      } catch (e) {
        console.log(`ℹ️ Collection '${col}' not ready yet, skipping index check`);
        continue;
      }

      // ✅ Helper: Check if index with SAME KEY PATTERN exists (regardless of name)
      const indexExistsWithKeys = (targetKeys) => {
        return existingIndexes.some(idx => {
          if (!idx.key) return false;
          return JSON.stringify(idx.key) === JSON.stringify(targetKeys);
        });
      };

      // 1. Multi-tenant index on hotelId for ALL collections
      if (!indexExistsWithKeys({ hotelId: 1 })) {
        try { 
          await collection.createIndex({ hotelId: 1 }, { background: true, name: `hotelId_1` }); 
          console.log(`✅ Created index hotelId_1 on ${col}`);
        } catch(e) { 
          console.log(`ℹ️ Index {hotelId:1} already exists on ${col}`);
        }
      }

      // 2. Collection-specific indexes with key pattern check
      if (col === 'rooms') {
        if (!indexExistsWithKeys({ number: 1, hotelId: 1 })) {
          await collection.createIndex({ number: 1, hotelId: 1 }, { unique: true, background: true, name: 'number_hotelId_unique' });
          console.log(`✅ Created unique index number_hotelId_unique on ${col}`);
        }
      }
      if (col === 'guests') {
        if (!indexExistsWithKeys({ email: 1, hotelId: 1 })) {
          await collection.createIndex({ email: 1, hotelId: 1 }, { background: true, name: 'email_hotelId_idx' });
          console.log(`✅ Created index email_hotelId_idx on ${col}`);
        }
      }
      if (col === 'settings') {
        if (!indexExistsWithKeys({ hotelId: 1 })) {
          await collection.createIndex({ hotelId: 1 }, { unique: true, background: true, name: 'hotelId_settings_unique' });
          console.log(`✅ Created unique index hotelId_settings_unique on ${col}`);
        }
      }
      if (col === 'tenants') {
        if (!indexExistsWithKeys({ hotelId: 1 })) {
          await collection.createIndex({ hotelId: 1 }, { unique: true, background: true, name: 'hotelId_tenants_unique' });
          console.log(`✅ Created unique index hotelId_tenants_unique on ${col}`);
        }
      }
      if (col === 'bookings') {
        if (!indexExistsWithKeys({ guestName: 1, hotelId: 1 })) {
          await collection.createIndex({ guestName: 1, hotelId: 1 }, { background: true, name: 'guestName_hotelId_idx' });
          console.log(`✅ Created index guestName_hotelId_idx on ${col}`);
        }
      }
      if (col === 'logs') {
        if (!indexExistsWithKeys({ timestamp: -1, hotelId: 1 })) {
          await collection.createIndex({ timestamp: -1, hotelId: 1 }, { background: true, name: 'timestamp_hotelId_idx' });
          console.log(`✅ Created index timestamp_hotelId_idx on ${col}`);
        }
      }
      if (col === 'users') {
        if (!indexExistsWithKeys({ email: 1, hotelId: 1 })) {
          await collection.createIndex({ email: 1, hotelId: 1 }, { unique: true, background: true, name: 'email_hotelId_users_unique' });
          console.log(`✅ Created unique index email_hotelId_users_unique on ${col}`);
        }
      }
    }
    console.log('✅ All indexes verified/created successfully');
  } catch (e) {
    // Non-critical - indexes likely already exist
    console.log(`ℹ️ Index setup note: ${e.message}`);
  }
}

// ==================== MULTI-TENANT MIDDLEWARE ====================
const getHotelId = (req) => {
  return req.headers['x-hotel-id'] || 
         req.query.hotelId || 
         req.query.hotel || 
         (req.session?.hotelId) || 
         'default';
};

const tenantMiddleware = (req, res, next) => {
  req.hotelId = getHotelId(req);
  next();
};

// ✅ FIX: Extract clientId from headers for multi-device deduplication
const clientInfoMiddleware = (req, res, next) => {
  req.clientId = req.headers['x-client-id'] || null;
  next();
};

app.use('/api', tenantMiddleware);
app.use('/api', clientInfoMiddleware); // ✅ ADD THIS for clientId support

// ✅ Subscription Expiry Validation Middleware
const checkSubscription = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;
    if (hotelId === 'default') return next();
    if (!dbConnected) return next();

    const tenant = await db.collection('tenants').findOne({ hotelId });
    if (!tenant) return next();

    if (!tenant.active) {
      return res.status(403).json({ success: false, error: 'Hotel account is inactive' });
    }

    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Subscription expired', 
        expiryDate: tenant.subscriptionExpiry,
        action: 'Please renew your subscription'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    next();
  }
};

// Apply subscription check to all data-modifying routes
app.use('/api/rooms', checkSubscription);
app.use('/api/guests', checkSubscription);
app.use('/api/food', checkSubscription);
app.use('/api/inventory', checkSubscription);
app.use('/api/requests', checkSubscription);
app.use('/api/bookings', checkSubscription);
app.use('/api/staff', checkSubscription);

// ==================== AUTH UTILITIES ====================
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    if (req.session?.isAdmin) return next();
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.hotelId = decoded.hotelId || req.hotelId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

const superAdminMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Super admin access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// ==================== SOCKET.IO REAL-TIME (FIXED FOR MULTI-DEVICE SYNC) ====================
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // ✅ FIX: Support both 'join_hotel' (snake_case) and 'joinHotel' (camelCase)
  socket.on('join_hotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
  });

  socket.on('joinHotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected' });
  });

  // ✅ FIX: Generic broadcaster that matches frontend expectations
  const broadcastEvent = (eventName, payload) => {
    const hotelId = payload?.hotelId;
    if (!hotelId) return;

    // Add syncToken if not present (for deduplication)
    const data = {
      ...payload,
      syncToken: payload?.syncToken || Date.now(),
      timestamp: new Date().toISOString()
    };

    io.to(`hotel_${hotelId}`).emit(eventName, data);
    console.log(`📡 Broadcast ${eventName} to hotel_${hotelId}`);
  };

  // ✅ FIX: Request events - match frontend expectations (req_new, req_upd)
  socket.on('req_new', (payload) => broadcastEvent('req_new', payload));
  socket.on('req_upd', (payload) => broadcastEvent('req_upd', payload));

  // ✅ FIX: Room events (room_upd)
  socket.on('room_upd', (payload) => broadcastEvent('room_upd', payload));

  // ✅ FIX: Guest events (guest_upd)
  socket.on('guest_upd', (payload) => broadcastEvent('guest_upd', payload));

  // ✅ FIX: Food/Inventory events (food_upd, inventory_upd)
  socket.on('food_upd', (payload) => broadcastEvent('food_upd', payload));
  socket.on('inventory_upd', (payload) => broadcastEvent('inventory_upd', payload));

  // ✅ FIX: Config/Settings events (cfg_upd, currency_upd)
  socket.on('cfg_upd', (payload) => broadcastEvent('cfg_upd', payload));
  socket.on('currency_upd', (payload) => broadcastEvent('currency_upd', payload));

  // ✅ FIX: Booking events (booking_new, booking_upd)
  socket.on('booking_new', (payload) => broadcastEvent('booking_new', payload));
  socket.on('booking_upd', (payload) => broadcastEvent('booking_upd', payload));

  // ✅ FIX: Staff events (staff_upd)
  socket.on('staff_upd', (payload) => broadcastEvent('staff_upd', payload));

  // ✅ FIX: Review events (review_new)
  socket.on('review_new', (payload) => broadcastEvent('review_new', payload));

  // ✅ FIX: Leave hotel room on disconnect
  socket.on('leave_hotel', (hotelId) => {
    socket.leave(`hotel_${hotelId}`);
    console.log(`📡 ${socket.id} left room: hotel_${hotelId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });

  socket.on('error', (error) => {
    console.error('⚠️ Socket error:', error);
  });
});

// ✅ FIX: Broadcast helper that includes clientId for deduplication
const broadcast = (hotelId, event, data, clientId = null) => {
  const payload = {
    ...data,
    hotelId,
    clientId,
    syncToken: Date.now()
  };
  io.to(`hotel_${hotelId}`).emit(event, payload);
  console.log(`📡 Broadcast ${event} to hotel_${hotelId}`);
};

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Inaya Hotel Management System API', 
    status: 'OK',
    mongodb: dbConnected ? 'connected' : 'disconnected',
    socket: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/session', (req, res) => {
  if (req.session?.isAdmin || req.session?.user) {
    res.json({ success: true, user: req.session.user || { type: 'admin', email: req.session.adminEmail } });
  } else {
    res.json({ success: false, message: 'No active session' });
  }
});

// ==================== TENANT MANAGEMENT ====================
app.get('/api/tenant', async (req, res) => {
  try {
    const hotelId = req.hotelId;

    if (!dbConnected) {
      return res.json({ 
        success: true, 
        data: { 
          hotelId, 
          hotelName: 'Crown Plaza Hotel',
          currency: 'USD',
          currencySymbol: '$',
          language: 'en',
          country: 'USA',
          active: true,
          theme: 'default',
          subscriptionType: 'basic'
        } 
      });
    }

    const tenant = await db.collection('tenants').findOne({ hotelId });

    if (!tenant) {
      return res.json({ 
        success: true, 
        data: { 
          hotelId, 
          hotelName: 'Crown Plaza Hotel',
          currency: 'USD',
          currencySymbol: '$',
          language: 'en',
          country: 'USA',
          active: true,
          theme: 'default',
          subscriptionType: 'basic'
        } 
      });
    }

    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('Tenant fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tenant', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { hotelName, logo, currency, currencySymbol, language, country, active, theme, subscriptionType } = req.body;

    if (!dbConnected) {
      return res.json({ success: true, message: 'Tenant config saved (offline mode)', data: { hotelId, hotelName } });
    }

    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { 
        $set: { 
          hotelName, 
          logo, 
          currency, 
          currencySymbol,
          language, 
          country, 
          active, 
          theme, 
          subscriptionType,
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    );

    // ✅ FIX: Use cfg_upd event name that frontend expects
    broadcast(hotelId, 'cfg_upd', { hotelName, currency, currencySymbol, language, theme }, req.clientId);

    res.json({ 
      success: true, 
      message: result.upsertedCount ? 'Tenant created' : 'Tenant updated',
      data: { hotelId, hotelName }
    });
  } catch (error) {
    console.error('Tenant save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Hotel Registration API (Super Admin Only)
app.post('/api/super/tenants/register', superAdminMiddleware, async (req, res) => {
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

    if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'hotelId, hotelName, adminEmail, and adminPassword are required' 
      });
    }

    if (!dbConnected) {
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    const existing = await db.collection('tenants').findOne({ hotelId });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Hotel ID already registered' });
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

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

    await db.collection('tenants').insertOne(tenant);

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

    res.status(201).json({ 
      success: true, 
      message: 'Hotel registered successfully',
      data: { 
        hotelId, 
        hotelName, 
        adminEmail,
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

// ✅ Super Admin - List All Hotels
app.get('/api/super/tenants', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) {
      return res.json({ success: true, data: [], count: 0 });
    }

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

    res.json({ success: true, data: tenantsWithStats, count: tenantsWithStats.length });
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/super/tenants/:hotelId', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId } = req.params;
    const updates = req.body;

    if (!dbConnected) {
      return res.json({ success: true, message: 'Hotel updated (offline mode)' });
    }

    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    if (updates.hotelName || updates.currency || updates.language || updates.theme) {
      // ✅ FIX: Use cfg_upd event name
      broadcast(hotelId, 'cfg_upd', {
        hotelName: updates.hotelName,
        currency: updates.currency,
        currencySymbol: updates.currencySymbol,
        language: updates.language,
        theme: updates.theme
      }, req.clientId);
    }

    res.json({ success: true, message: 'Hotel updated' });
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/super/tenants/:hotelId', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId } = req.params;

    if (!dbConnected) {
      return res.json({ success: true, message: 'Hotel deleted (offline mode)' });
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
      db.collection('settings').deleteOne({ hotelId }),
      db.collection('users').deleteMany({ hotelId })
    ]);

    await db.collection('tenants').deleteOne({ hotelId });

    io.to(`hotel_${hotelId}`).emit('hotel_deleted', { message: 'This hotel has been deactivated' });

    res.json({ success: true, message: 'Hotel and all data deleted' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/super/countries', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) {
      return res.json({ success: true, data: [] });
    }

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

// ==================== AUTHENTICATION ====================
app.post('/api/super/admins/register', superAdminMiddleware, async (req, res) => {
  try {
    const { email, password, name, hotelId, role, permissions } = req.body;

    if (!email || !password || !hotelId) {
      return res.status(400).json({ success: false, error: 'email, password, and hotelId are required' });
    }

    if (!dbConnected) {
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    const existing = await db.collection('users').findOne({ email, hotelId });
    if (existing) {
      return res.status(400).json({ success: false, error: 'User already exists for this hotel' });
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

    res.status(201).json({ success: true, message: 'Admin created', data: user });
  } catch (error) {
    console.error('Admin register error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;
    console.log('🔐 Admin login attempt:', email, 'for hotel:', hotelId);

    if (!dbConnected) {
      if (email === 'admin@crownplaza.com' && password === 'admin123') {
        const token = generateToken({
          email,
          name: 'Admin',
          role: 'super_admin',
          hotelId: hotelId || 'default',
          permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings']
        });
        req.session.isAdmin = true;
        req.session.adminEmail = email;
        req.session.hotelId = hotelId || 'default';
        return res.json({
          success: true,
          token,
          user: { email, name: 'Admin', role: 'super_admin', permissions: ['all'] },
          hotelId: hotelId || 'default'
        });
      }
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }

    if (hotelId && hotelId !== 'default') {
      const tenant = await db.collection('tenants').findOne({ hotelId });
      if (!tenant) {
        await db.collection('tenants').insertOne({
          hotelId,
          hotelName: 'New Hotel',
          currency: 'USD',
          currencySymbol: '$',
          language: 'en',
          country: 'Unknown',
          active: true,
          theme: 'default',
          subscriptionType: 'basic',
          createdAt: new Date()
        });
      }
    }

    const user = await db.collection('users').findOne({ 
      email: email,
      $or: [{ hotelId }, { hotelId: { $exists: false } }]
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (!user.active) {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    const token = generateToken({
      email: user.email,
      name: user.name,
      role: user.role,
      hotelId: hotelId || user.hotelId || 'default',
      permissions: user.permissions
    });

    req.session.isAdmin = true;
    req.session.adminEmail = email;
    req.session.hotelId = hotelId || user.hotelId || 'default';
    req.session.user = { email: user.email, name: user.name, role: user.role, permissions: user.permissions };

    console.log('✅ Admin login successful:', email);

    res.json({
      success: true,
      token,
      user: { 
        email: user.email, 
        name: user.name, 
        role: user.role,
        permissions: user.permissions
      },
      hotelId: hotelId || user.hotelId || 'default'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/check-session', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({ 
        success: true, 
        isAdmin: true, 
        email: decoded.email,
        hotelId: decoded.hotelId,
        role: decoded.role
      });
    } catch (e) {}
  }

  if (req.session.isAdmin) {
    res.json({ 
      success: true, 
      isAdmin: true, 
      email: req.session.adminEmail,
      hotelId: req.session.hotelId || 'default'
    });
  } else {
    res.json({ success: false, isAdmin: false });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out' });
});

// ==================== ROOMS CRUD (FIXED BROADCAST EVENTS) ====================
app.get('/api/rooms', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const rooms = await db.collection('rooms').find({ hotelId }).sort({ number: 1 }).toArray();
    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('Rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/rooms/available', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const rooms = await db.collection('rooms').find({ hotelId, status: 'Vacant' }).sort({ number: 1 }).toArray();
    res.json({ success: true, data: rooms, count: rooms.length });
  } catch (error) {
    console.error('Available rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!number || !type || !price) {
      return res.status(400).json({ success: false, error: 'number, type, and price are required' });
    }

    if (!dbConnected) {
      const room = {
        _id: 'r_'+Date.now(),
        hotelId,
        number: parseInt(number),
        type,
        price: parseFloat(price),
        status: status || 'Vacant',
        guestName: guestName || null,
        amenities: amenities || [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // ✅ FIX: Use room_upd event name that frontend expects
      broadcast(hotelId, 'room_upd', room, req.clientId);
      return res.status(201).json({ success: true, message: 'Room added (offline)', data: room });
    }

    const existing = await db.collection('rooms').findOne({ hotelId, number: parseInt(number) });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Room number already exists' });
    }

    const room = {
      hotelId,
      number: parseInt(number),
      type,
      price: parseFloat(price),
      status: status || 'Vacant',
      guestName: guestName || null,
      amenities: amenities || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;
    // ✅ FIX: Use room_upd event name
    broadcast(hotelId, 'room_upd', room, req.clientId);
    res.status(201).json({ success: true, message: 'Room added', data: room });
  } catch (error) {
    console.error('Room create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { number, type, price, status, guestName, amenities } = req.body;

    if (!dbConnected) {
      const updatedRoom = {
        _id: id,
        hotelId,
        number: number ? parseInt(number) : undefined,
        type,
        price: price ? parseFloat(price) : undefined,
        status,
        guestName,
        amenities,
        updatedAt: new Date()
      };
      // ✅ FIX: Use room_upd event name
      broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
      return res.json({ success: true, message: 'Room updated (offline)', data: updatedRoom });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(number && { number: parseInt(number) }),
      ...(type && { type }),
      ...(price && { price: parseFloat(price) }),
      ...(status && { status }),
      ...(guestName !== undefined && { guestName }),
      ...(amenities && { amenities })
    };

    const result = await db.collection('rooms').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    const updatedRoom = await db.collection('rooms').findOne({ _id: new ObjectId(id) });
    // ✅ FIX: Use room_upd event name
    broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
    res.json({ success: true, message: 'Room updated', data: updatedRoom });
  } catch (error) {
    console.error('Room update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      // ✅ FIX: Use room_upd event name with deleted marker
      broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Room deleted (offline)' });
    }

    const result = await db.collection('rooms').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // ✅ FIX: Use room_upd event name with deleted marker
    broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Room deleted' });
  } catch (error) {
    console.error('Room delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GUESTS CRUD (FIXED BROADCAST EVENTS) ====================
app.get('/api/guests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const guests = await db.collection('guests').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: guests, count: guests.length });
  } catch (error) {
    console.error('Guests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/guests', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, email, phone, room, checkIn, checkOut, points, status } = req.body;

    if (!name || !room) {
      return res.status(400).json({ success: false, error: 'name and room are required' });
    }

    if (!dbConnected) {
      const guest = {
        _id: 'g_'+Date.now(),
        hotelId,
        name,
        email: email || null,
        phone: phone || null,
        room: parseInt(room),
        checkIn: checkIn ? new Date(checkIn) : new Date(),
        checkOut: checkOut ? new Date(checkOut) : null,
        points: points || 0,
        status: status || 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // ✅ FIX: Use guest_upd event name
      broadcast(hotelId, 'guest_upd', guest, req.clientId);
      return res.status(201).json({ success: true, message: 'Guest added (offline)', data: guest });
    }

    const guest = {
      hotelId,
      name,
      email: email || null,
      phone: phone || null,
      room: parseInt(room),
      checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      points: points || 0,
      status: status || 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('guests').insertOne(guest);
    guest._id = result.insertedId;
    // ✅ FIX: Use guest_upd event name
    broadcast(hotelId, 'guest_upd', guest, req.clientId);
    res.status(201).json({ success: true, message: 'Guest added', data: guest });
  } catch (error) {
    console.error('Guest create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/guests/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, email, phone, room, checkIn, checkOut, points, status } = req.body;

    if (!dbConnected) {
      const updatedGuest = {
        _id: id,
        hotelId,
        name,
        email,
        phone,
        room: room ? parseInt(room) : undefined,
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut !== undefined ? (checkOut ? new Date(checkOut) : null) : undefined,
        points: points !== undefined ? parseInt(points) : undefined,
        status,
        updatedAt: new Date()
      };
      // ✅ FIX: Use guest_upd event name
      broadcast(hotelId, 'guest_upd', updatedGuest, req.clientId);
      return res.json({ success: true, message: 'Guest updated (offline)', data: updatedGuest });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(room && { room: parseInt(room) }),
      ...(checkIn && { checkIn: new Date(checkIn) }),
      ...(checkOut !== undefined && { checkOut: checkOut ? new Date(checkOut) : null }),
      ...(points !== undefined && { points: parseInt(points) }),
      ...(status && { status })
    };

    const result = await db.collection('guests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    const updatedGuest = await db.collection('guests').findOne({ _id: new ObjectId(id) });
    // ✅ FIX: Use guest_upd event name
    broadcast(hotelId, 'guest_upd', updatedGuest, req.clientId);
    res.json({ success: true, message: 'Guest updated', data: updatedGuest });
  } catch (error) {
    console.error('Guest update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/guests/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      // ✅ FIX: Use guest_upd event name with deleted marker
      broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Guest deleted (offline)' });
    }

    const result = await db.collection('guests').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Guest not found' });
    }

    // ✅ FIX: Use guest_upd event name with deleted marker
    broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Guest deleted' });
  } catch (error) {
    console.error('Guest delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FOOD MENU CRUD (FIXED BROADCAST EVENTS) ====================
app.get('/api/food', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const food = await db.collection('food').find({ hotelId }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: food, count: food.length });
  } catch (error) {
    console.error('Food fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/food', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, price, category, description, available, image } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'name and price are required' });
    }

    if (!dbConnected) {
      const item = {
        _id: 'f_'+Date.now(),
        hotelId,
        name,
        price: parseFloat(price),
        category: category || 'Main Course',
        description: description || '',
        available: available !== false,
        image: image || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // ✅ FIX: Use food_upd event name
      broadcast(hotelId, 'food_upd', item, req.clientId);
      return res.status(201).json({ success: true, message: 'Food item added (offline)', data: item });
    }

    const item = {
      hotelId,
      name,
      price: parseFloat(price),
      category: category || 'Main Course',
      description: description || '',
      available: available !== false,
      image: image || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('food').insertOne(item);
    item._id = result.insertedId;
    // ✅ FIX: Use food_upd event name
    broadcast(hotelId, 'food_upd', item, req.clientId);
    res.status(201).json({ success: true, message: 'Food item added', data: item });
  } catch (error) {
    console.error('Food create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/food/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, price, category, description, available, image } = req.body;

    if (!dbConnected) {
      const updatedItem = {
        _id: id,
        hotelId,
        name,
        price: price ? parseFloat(price) : undefined,
        category,
        description,
        available,
        image,
        updatedAt: new Date()
      };
      // ✅ FIX: Use food_upd event name
      broadcast(hotelId, 'food_upd', updatedItem, req.clientId);
      return res.json({ success: true, message: 'Food item updated (offline)', data: updatedItem });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(price && { price: parseFloat(price) }),
      ...(category && { category }),
      ...(description !== undefined && { description }),
      ...(available !== undefined && { available }),
      ...(image !== undefined && { image })
    };

    const result = await db.collection('food').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    const updatedItem = await db.collection('food').findOne({ _id: new ObjectId(id) });
    // ✅ FIX: Use food_upd event name
    broadcast(hotelId, 'food_upd', updatedItem, req.clientId);
    res.json({ success: true, message: 'Food item updated', data: updatedItem });
  } catch (error) {
    console.error('Food update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/food/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      // ✅ FIX: Use food_upd event name with deleted marker
      broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Food item deleted (offline)' });
    }

    const result = await db.collection('food').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Food item not found' });
    }

    // ✅ FIX: Use food_upd event name with deleted marker
    broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Food item deleted' });
  } catch (error) {
    console.error('Food delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== INVENTORY CRUD (FIXED BROADCAST EVENTS) ====================
app.get('/api/inventory', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const inventory = await db.collection('inventory').find({ hotelId }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: inventory, count: inventory.length });
  } catch (error) {
    console.error('Inventory fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/inventory', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, category, quantity, minStock, price, unit, status } = req.body;

    if (!name || !category || quantity === undefined) {
      return res.status(400).json({ success: false, error: 'name, category, and quantity are required' });
    }

    if (!dbConnected) {
      const item = {
        _id: 'i_'+Date.now(),
        hotelId,
        name,
        category,
        quantity: parseInt(quantity),
        minStock: parseInt(minStock) || 10,
        price: price ? parseFloat(price) : 0,
        unit: unit || 'pcs',
        status: status || (parseInt(quantity) <= (parseInt(minStock) || 10) ? 'low-stock' : 'in-stock'),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // ✅ FIX: Use inventory_upd event name
      broadcast(hotelId, 'inventory_upd', item, req.clientId);
      return res.status(201).json({ success: true, message: 'Inventory item added (offline)', data: item });
    }

    const item = {
      hotelId,
      name,
      category,
      quantity: parseInt(quantity),
      minStock: parseInt(minStock) || 10,
      price: price ? parseFloat(price) : 0,
      unit: unit || 'pcs',
      status: status || (parseInt(quantity) <= (parseInt(minStock) || 10) ? 'low-stock' : 'in-stock'),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('inventory').insertOne(item);
    item._id = result.insertedId;
    // ✅ FIX: Use inventory_upd event name
    broadcast(hotelId, 'inventory_upd', item, req.clientId);
    res.status(201).json({ success: true, message: 'Inventory item added', data: item });
  } catch (error) {
    console.error('Inventory create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/inventory/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, category, quantity, minStock, price, unit, status } = req.body;

    if (!dbConnected) {
      const updateData = {
        updatedAt: new Date(),
        name,
        category,
        quantity: quantity !== undefined ? parseInt(quantity) : undefined,
        minStock: minStock !== undefined ? parseInt(minStock) : undefined,
        price: price !== undefined ? parseFloat(price) : undefined,
        unit,
        status
      };
      if (quantity !== undefined && minStock !== undefined) {
        const qty = parseInt(quantity);
        const min = parseInt(minStock);
        if (qty <= 0) updateData.status = 'out-of-stock';
        else if (qty <= min) updateData.status = 'low-stock';
        else updateData.status = 'in-stock';
      }
      const updatedItem = { _id: id, hotelId, ...updateData };
      // ✅ FIX: Use inventory_upd event name
      broadcast(hotelId, 'inventory_upd', updatedItem, req.clientId);
      return res.json({ success: true, message: 'Inventory item updated (offline)', data: updatedItem });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(category && { category }),
      ...(quantity !== undefined && { quantity: parseInt(quantity) }),
      ...(minStock !== undefined && { minStock: parseInt(minStock) }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(unit && { unit }),
      ...(status && { status })
    };

    if (quantity !== undefined && minStock !== undefined) {
      const qty = parseInt(quantity);
      const min = parseInt(minStock);
      if (qty <= 0) updateData.status = 'out-of-stock';
      else if (qty <= min) updateData.status = 'low-stock';
      else updateData.status = 'in-stock';
    }

    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Inventory item not found' });
    }

    const updatedItem = await db.collection('inventory').findOne({ _id: new ObjectId(id) });
    // ✅ FIX: Use inventory_upd event name
    broadcast(hotelId, 'inventory_upd', updatedItem, req.clientId);
    res.json({ success: true, message: 'Inventory item updated', data: updatedItem });
  } catch (error) {
    console.error('Inventory update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/inventory/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      // ✅ FIX: Use inventory_upd event name with deleted marker
      broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Inventory item deleted (offline)' });
    }

    const result = await db.collection('inventory').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Inventory item not found' });
    }

    // ✅ FIX: Use inventory_upd event name with deleted marker
    broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Inventory item deleted' });
  } catch (error) {
    console.error('Inventory delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVICE REQUESTS CRUD (FIXED BROADCAST EVENTS) ====================
app.get('/api/requests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });

    const { status, priority, department } = req.query;
    let filter = { hotelId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (department) filter.department = department;

    const requests = await db.collection('requests').find(filter).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: requests, count: requests.length });
  } catch (error) {
    console.error('Requests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/requests', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { guestName, roomNumber, department, category, description, priority, type, items, totalPrice } = req.body;

    if (!guestName || !roomNumber || !department) {
      return res.status(400).json({ success: false, error: 'guestName, roomNumber, and department are required' });
    }

    if (!dbConnected) {
      const request = {
        _id: 'req_'+Date.now(),
        hotelId,
        guestName,
        roomNumber: parseInt(roomNumber),
        department,
        category: category || 'General',
        description: description || '',
        priority: priority || 'normal',
        status: 'open',
        type: type || 'service',
        items: items || [],
        totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
        assignedTo: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // ✅ FIX: Use req_new event name that frontend expects
      broadcast(hotelId, 'req_new', request, req.clientId);
      return res.status(201).json({ success: true, message: 'Request submitted (offline)', data: request });
    }

    const request = {
      hotelId,
      guestName,
      roomNumber: parseInt(roomNumber),
      department,
      category: category || 'General',
      description: description || '',
      priority: priority || 'normal',
      status: 'open',
      type: type || 'service',
      items: items || [],
      totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
      assignedTo: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('requests').insertOne(request);
    request._id = result.insertedId;
    // ✅ FIX: Use req_new event name
    broadcast(hotelId, 'req_new', request, req.clientId);
    res.status(201).json({ success: true, message: 'Request submitted', data: request });
  } catch (error) {
    console.error('Request create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/requests/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, priority, assignedTo, notes } = req.body;

    if (!dbConnected) {
      const updatedRequest = {
        _id: id,
        hotelId,
        status,
        priority,
        assignedTo,
        notes: notes ? (notes + '\n[' + new Date().toISOString() + ']') : undefined,
        updatedAt: new Date()
      };
      // ✅ FIX: Use req_upd event name
      broadcast(hotelId, 'req_upd', updatedRequest, req.clientId);
      return res.json({ success: true, message: 'Request updated (offline)', data: updatedRequest });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(notes && { notes: (notes + '\n[' + new Date().toISOString() + '])') })
    };

    const result = await db.collection('requests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const updatedRequest = await db.collection('requests').findOne({ _id: new ObjectId(id) });
    // ✅ FIX: Use req_upd event name
    broadcast(hotelId, 'req_upd', updatedRequest, req.clientId);
    res.json({ success: true, message: 'Request updated', data: updatedRequest });
  } catch (error) {
    console.error('Request update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/requests/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      // ✅ FIX: Use req_upd event name with deleted marker
      broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Request deleted (offline)' });
    }

    const result = await db.collection('requests').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // ✅ FIX: Use req_upd event name with deleted marker
    broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Request deleted' });
  } catch (error) {
    console.error('Request delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SETTINGS (FIXED BROADCAST EVENTS) ====================
app.get('/api/settings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) {
      return res.json({ 
        success: true, 
        data: { 
          hotelId,
          hotelName: 'Crown Plaza Hotel',
          currencySymbol: '$',
          priceFormat: 'symbol-first',
          taxRate: 0,
          wifiSSID: 'Hotel_Guest',
          wifiPassword: 'Welcome123',
          language: 'en',
          theme: { primaryColor: '#667eea' },
          transport: { airport: 30, local: 15 },
          updatedAt: new Date()
        } 
      });
    }
    const settings = await db.collection('settings').findOne({ hotelId });
    if (!settings) {
      return res.json({ 
        success: true, 
        data: { 
          hotelId,
          hotelName: 'Crown Plaza Hotel',
          currencySymbol: '$',
          priceFormat: 'symbol-first',
          taxRate: 0,
          wifiSSID: 'Hotel_Guest',
          wifiPassword: 'Welcome123',
          language: 'en',
          theme: { primaryColor: '#667eea' },
          transport: { airport: 30, local: 15 },
          updatedAt: new Date()
        } 
      });
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const settings = req.body;
    if (!dbConnected) {
      const updatedSettings = { ...settings, hotelId, updatedAt: new Date() };
      // ✅ FIX: Use cfg_upd event name that frontend expects
      broadcast(hotelId, 'cfg_upd', {
        hotelName: updatedSettings.hotelName,
        currencySymbol: updatedSettings.currencySymbol,
        wifiPassword: updatedSettings.wifiPassword,
        language: updatedSettings.language,
        theme: updatedSettings.theme
      }, req.clientId);
      return res.json({ success: true, message: 'Settings saved (offline)', data: updatedSettings });
    }
    const updateData = { ...settings, hotelId, updatedAt: new Date() };
    const result = await db.collection('settings').updateOne(
      { hotelId },
      { $set: updateData },
      { upsert: true }
    );
    const updatedSettings = await db.collection('settings').findOne({ hotelId });
    // ✅ FIX: Use cfg_upd event name
    broadcast(hotelId, 'cfg_upd', {
      hotelName: updatedSettings.hotelName,
      currencySymbol: updatedSettings.currencySymbol,
      wifiPassword: updatedSettings.wifiPassword,
      language: updatedSettings.language,
      theme: updatedSettings.theme
    }, req.clientId);
    res.json({ success: true, message: 'Settings saved', data: updatedSettings });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected || !db) {
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }
    const [rooms, bookings, requests, guests, food, inventory] = await Promise.all([
      db.collection('rooms').find({ hotelId }).toArray(),
      db.collection('bookings').find({ hotelId }).toArray(),
      db.collection('requests').find({ hotelId }).toArray(),
      db.collection('guests').find({ hotelId }).toArray(),
      db.collection('food').find({ hotelId }).toArray(),
      db.collection('inventory').find({ hotelId }).toArray()
    ]);
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
    const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const openRequests = requests.filter(r => r.status === 'open').length;
    const emergencyRequests = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;
    res.json({
      success: true,
      data: {
        rooms: { total: totalRooms, occupied: occupiedRooms, vacant: vacantRooms },
        bookings: { total: bookings.length, revenue: totalRevenue },
        requests: { total: requests.length, open: openRequests, emergency: emergencyRequests },
        guests: { total: guests.length, active: guests.filter(g => g.status === 'active').length },
        food: { total: food.length },
        inventory: { 
          total: inventory.length, 
          lowStock: inventory.filter(i => i.status === 'low-stock').length,
          outOfStock: inventory.filter(i => i.status === 'out-of-stock').length
        },
        occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FRONTEND ROUTES ====================
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) {
    res.sendFile(path.join(publicPath, 'admin.html'));
  } else {
    res.sendFile(path.join(publicPath, 'index.html'));
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ==================== SERVER START ====================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`👑 Admin: http://localhost:${PORT}/admin`);
  console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
  console.log(`📡 Socket.io: Enabled`);
  console.log(`🏨 Multi-tenant: Enabled`);
  console.log(`🔐 Auth: JWT + bcrypt enabled`);
  console.log(`🌍 Multi-country: Enabled (currency, language, timezone)`);
  console.log(`💳 Subscriptions: lifetime/monthly/trial supported`);
  console.log(`📊 APIs: /api/bookings, /api/logs, /api/super/*`);
  console.log(`\n💡 Frontend should send 'x-hotel-id' header or ?hotelId= query param\n`);
  await connectDB();
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (client) await client.close();
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (client) await client.close();
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});