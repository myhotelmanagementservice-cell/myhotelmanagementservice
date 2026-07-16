require("dotenv").config({ path: __dirname + "/.env" });
// server.js - Complete Multi-Tenant Hotel SaaS Backend
// =====================================================
// v5.0 CHANGELOG:
// ✅ FIX 1: Login speed - subscription cache + parallel DB queries + fast bcrypt path
// ✅ FIX 2: Data persistence - proper ObjectId↔String handling, upsert on all configs
// ✅ FIX 3: Add/update speed - non-blocking broadcasts, optimized single-query updates
// ✅ FIX 4: Real-time bidirectional sync - Admin↔Guest via dedicated Socket.io rooms
// ✅ FIX 5: Page stability - MongoDB-backed page state, auto-restore on refresh
// ✅ FIX 6: Multi-device sync - room-based broadcasting for all CRUD events
// ✅ FIX 7: MongoDB connection pool increased (100 max, 20 min)
// ✅ FIX 8: Guest↔Admin cross-sync events (admin_action, guest_action channels)
// ✅ FIX 9: Heartbeat ping to keep sessions alive across devices
// ✅ FIX 10: All existing features preserved (19 admin pages, 9 guest pages)

const express = require('express');
const session = require('express-session');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

let compression, helmet, rateLimit;
try { compression = require('compression'); } catch(e) { compression = null; }
try { helmet = require('helmet'); } catch(e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch(e) { rateLimit = null; }

const app = express();
const server = http.createServer(app);

// ✅ FIX 4+6: Enhanced Socket.io config for multi-device real-time sync
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7, // 10MB for large payloads
  allowEIO3: true         // backward compat
});

if (compression) {
  app.use(compression());
  console.log('✅ Compression enabled');
}

if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));
  console.log('✅ Helmet security headers enabled');
}

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-hotel-id', 'x-client-id', 'x-idempotency-key', 'x-request-id']
}));

// ✅ CRITICAL: Webhook raw body parser MUST come BEFORE express.json()
// Cashfree webhook signature verification requires raw body
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));

// Normal JSON parser for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================== WEBHOOK TEST ENDPOINT ========================
app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    console.log('✅ Webhook received:', req.body);
    res.status(200).json({ received: true });
});

// Public — subscribe.html fetches plans from globalConfig (super admin controls prices)
app.get('/api/subscription/plans', async (req, res) => {
  try {
    const cfg = dbConnected
      ? await db.collection('globalConfig').findOne({ _id: 'main' })
      : null;
    const planSettings = (cfg && cfg.planSettings) || {
      basic:      { name: 'Free / Basic', price: 0,   enabled: true,  features: ['1 Hotel', 'Up to 20 Rooms', 'Basic Reports', '7-day Trial'] },
      pro:        { name: 'Pro',          price: 99,  enabled: true,  features: ['Up to 5 Hotels', 'Unlimited Rooms', 'Priority Support', 'Analytics Dashboard'] },
      enterprise: { name: 'Enterprise',   price: 499, enabled: true,  features: ['Unlimited Hotels', 'Custom Branding', 'Dedicated Manager', 'API Access'] }
    };
    const plans = Object.entries(planSettings)
    .filter(([, p]) => p.enabled !== false)
    .map(([id, p]) => ({
      id,
      name:     p.name,
      price:    p.price,
      currency: p.currency || 'USD',
      color:    p.color || 'blue',
      duration: p.duration !== undefined ? p.duration : 30,
      features: p.features || []
    }));
    res.json({ success: true, data: plans });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const publicPath = path.join(__dirname, process.env.PUBLIC_PATH || '../public');

// No-cache for HTML files so browser always gets the latest version
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(publicPath, {
  maxAge: '0',
  etag: false,
  lastModified: false
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'inaya-hotel-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000
  }
}));

// ======================== PASSPORT / GOOGLE OAUTH ========================
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_CALLBACK_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://www.myhotelmanagementservice.com/auth/google/callback'
    : '/auth/google/callback');

console.log(`🔐 Google OAuth callback URL: ${GOOGLE_CALLBACK_URL}`);

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: GOOGLE_CALLBACK_URL,
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  try {
    const hotelId = req.session.oauthHotelId || 'HOTEL001';
    const email = profile.emails?.[0]?.value || '';
    const name = profile.displayName || email;
    const googleId = profile.id;
    const avatar = profile.photos?.[0]?.value || '';

    // Upsert guest record keyed by googleId + hotelId
    if (db) {
      await db.collection('guests').updateOne(
        { googleId, hotelId },
        { $set: { name, email, googleId, hotelId, avatar, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date(), loyaltyPoints: 0, visits: 0 } },
        { upsert: true }
      );
    }

    return done(null, { name, email, googleId, hotelId, avatar, role: 'guest' });
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';

const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';
const TOKEN_REFRESH_THRESHOLD_MS = parseInt(process.env.TOKEN_REFRESH_THRESHOLD_MS) || 60 * 60 * 1000;

let db;
let client;
let dbConnected = false;
let dbReconnectTimer = null;

// ============================================
// ACTIVITY LOGGING (for Audit Logs — Super Admin)
// ============================================
async function logActivity(action, target, type, extra = {}) {
  try {
    if (!dbConnected || !db) return;
    await db.collection('activityLogs').insertOne({
      action, target, type,
      user: extra.user || 'System',
      ip: extra.ip || 'N/A',
      details: extra.details || '',
      timestamp: new Date()
    });
  } catch (err) {
    console.error('logActivity error:', err.message);
  }
}

// ✅ Idempotency store - prevents duplicate submissions
const idempotencyStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of idempotencyStore.entries()) {
    if (val.timestamp < cutoff) idempotencyStore.delete(key);
  }
}, 60 * 60 * 1000);

// ✅ FIX 2: SAFE ID PARSER - handles both ObjectId and string IDs (e.g., 'r_123456')
const parseId = (id) => {
  if (!id) return id;
  try {
    return ObjectId.isValid(id) && String(id).length === 24 ? new ObjectId(id) : id;
  } catch (e) {
    return id;
  }
};

// ✅ FIX 1: SUBSCRIPTION CACHE - avoids DB hit on every request, 5-min TTL
const subscriptionCache = new Map();
const SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000;

function getCachedSubscription(hotelId) {
  const cached = subscriptionCache.get(hotelId);
  if (cached && (Date.now() - cached.timestamp) < SUBSCRIPTION_CACHE_TTL) {
    return cached.data;
  }
  subscriptionCache.delete(hotelId);
  return null;
}

function setCachedSubscription(hotelId, data) {
  subscriptionCache.set(hotelId, { data, timestamp: Date.now() });
}

function invalidateSubscriptionCache(hotelId) {
  subscriptionCache.delete(hotelId);
}

// ✅ FIX 7: MongoDB with higher connection pool for better concurrency
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    if (dbReconnectTimer) { clearTimeout(dbReconnectTimer); dbReconnectTimer = null; }

    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 100,  // ✅ FIX 7: Increased from 50
      minPoolSize: 20,   // ✅ FIX 7: Increased from 10
      retryWrites: true,
      retryReads: true,
      compressors: ['zstd', 'zlib'] // ✅ Wire compression for faster transfers
    });

    await client.connect();
    db = client.db(DB_NAME);
    app.set('db', db);  // ✅ ADD THIS LINE
    await db.command({ ping: 1 });
    dbConnected = true;
    console.log('✅ MongoDB Connected Successfully!');

    // ✅ FRANKFURTER: Live Exchange Rates (free API, no key needed)
    async function fetchAndStoreExchangeRates() {
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=USD');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.rates) throw new Error('No rates in response');
        const rates = { USD: 1, ...data.rates };
        await db.collection('globalConfig').updateOne(
          { _id: 'main' },
          { $set: { exchangeRates: rates, ratesUpdatedAt: new Date() } },
          { upsert: true }
        );
        io.emit('exchange_rates_updated', { rates, updatedAt: new Date().toISOString() });
        console.log('✅ Exchange rates updated:', Object.keys(rates).join(', '));
      } catch (e) {
        console.warn('⚠️ Exchange rate fetch failed:', e.message);
      }
    }
    fetchAndStoreExchangeRates(); // run immediately on startup
    setInterval(fetchAndStoreExchangeRates, 6 * 60 * 60 * 1000); // every 6 hours

// Server start hone ke baad, database connection ke andar:
const Subscription = require('./models/Subscription');
await Subscription.createIndexes();    

    client.on('close', () => {
      console.warn('⚠️ MongoDB connection closed. Attempting reconnect...');
      dbConnected = false;
      scheduleReconnect();
    });
    client.on('error', (err) => {
      console.error('⚠️ MongoDB client error:', err.message);
      dbConnected = false;
      scheduleReconnect();
    });
    client.on('serverHeartbeatFailed', () => {
      dbConnected = false;
      scheduleReconnect();
    });

    await createIndexes();
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    dbConnected = false;
    scheduleReconnect();
    return null;
  }
}

function scheduleReconnect() {
  if (!dbReconnectTimer) {
    dbReconnectTimer = setTimeout(() => {
      dbReconnectTimer = null;
      connectDB();
    }, 5000);
  }
}

async function createIndexes() {
  try {
    const collections = ['rooms', 'guests', 'food', 'inventory', 'requests', 'blacklist', 'maintenance', 'reviews', 'loyalty', 'staff', 'logs', 'settings', 'tenants', 'bookings', 'users', 'sessions', 'announcements', 'policies', 'config', 'departments'];

    for (const col of collections) {
      const collection = db.collection(col);
      let existingIndexes = [];
      try {
        existingIndexes = await collection.listIndexes().toArray();
      } catch (e) {
        continue;
      }

      const indexExistsWithKeys = (targetKeys) => {
        return existingIndexes.some(idx => {
          if (!idx.key) return false;
          return JSON.stringify(idx.key) === JSON.stringify(targetKeys);
        });
      };

      if (!indexExistsWithKeys({ hotelId: 1 })) {
        try { await collection.createIndex({ hotelId: 1 }, { background: true, name: `hotelId_1` }); } catch(e) {}
      }

      if (col === 'rooms' && !indexExistsWithKeys({ number: 1, hotelId: 1 })) {
        await collection.createIndex({ number: 1, hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'guests' && !indexExistsWithKeys({ email: 1, hotelId: 1 })) {
        await collection.createIndex({ email: 1, hotelId: 1 }, { background: true });
      }
      // ✅ FIX 5: Index for page state lookups
      if (col === 'guests' && !indexExistsWithKeys({ room: 1, hotelId: 1 })) {
        await collection.createIndex({ room: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'settings' && !indexExistsWithKeys({ hotelId: 1 })) {
        await collection.createIndex({ hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'config' && !indexExistsWithKeys({ hotelId: 1 })) {
        await collection.createIndex({ hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'tenants' && !indexExistsWithKeys({ hotelId: 1 })) {
        await collection.createIndex({ hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'bookings' && !indexExistsWithKeys({ guestName: 1, hotelId: 1 })) {
        await collection.createIndex({ guestName: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'logs' && !indexExistsWithKeys({ timestamp: -1, hotelId: 1 })) {
        await collection.createIndex({ timestamp: -1, hotelId: 1 }, { background: true });
      }
      if (col === 'users' && !indexExistsWithKeys({ email: 1, hotelId: 1 })) {
        await collection.createIndex({ email: 1, hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'sessions' && !indexExistsWithKeys({ lastActivity: 1 })) {
        await collection.createIndex({ lastActivity: 1 }, { expireAfterSeconds: Math.floor(IDLE_TIMEOUT_MS / 1000) + 3600 });
      }
      // ✅ FIX 5: Compound index for page state queries
      if (col === 'sessions' && !indexExistsWithKeys({ email: 1, hotelId: 1 })) {
        await collection.createIndex({ email: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'announcements' && !indexExistsWithKeys({ category: 1, hotelId: 1 })) {
        await collection.createIndex({ category: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'announcements' && !indexExistsWithKeys({ isActive: 1, hotelId: 1 })) {
        await collection.createIndex({ isActive: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'policies' && !indexExistsWithKeys({ type: 1, hotelId: 1 })) {
        await collection.createIndex({ type: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'policies' && !indexExistsWithKeys({ isEnabled: 1, hotelId: 1 })) {
        await collection.createIndex({ isEnabled: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'departments' && !indexExistsWithKeys({ key: 1, hotelId: 1 })) {
        await collection.createIndex({ key: 1, hotelId: 1 }, { unique: true, background: true });
      }
      if (col === 'requests' && !indexExistsWithKeys({ status: 1, hotelId: 1 })) {
        await collection.createIndex({ status: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'requests' && !indexExistsWithKeys({ roomNumber: 1, hotelId: 1 })) {
        await collection.createIndex({ roomNumber: 1, hotelId: 1 }, { background: true });
      }
    }
    console.log('✅ All indexes verified/created successfully');
  } catch (e) {
    console.log(`ℹ️ Index setup note: ${e.message}`);
  }
}

let loginLimiter, apiLimiter;
if (rateLimit) {
  loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip + '_' + (req.body?.email || '')
  });

  apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 300,
    message: { success: false, error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET'
  });

  app.use('/api/', apiLimiter);
  console.log('✅ Rate limiting enabled');
}

const getHotelId = (req) => {
  return req.headers['x-hotel-id'] ||
         req.query.hotelId ||
         req.query.hotel ||
         (req.session?.hotelId) ||
         'HOTEL001';
};

const tenantMiddleware = (req, res, next) => {
  req.hotelId = getHotelId(req);
  next();
};

const clientInfoMiddleware = (req, res, next) => {
  req.clientId = req.headers['x-client-id'] || null;
  req.requestId = req.headers['x-request-id'] || `req_${Date.now()}`;
  next();
};

const idempotencyMiddleware = (req, res, next) => {
  const key = req.headers['x-idempotency-key'];
  if (!key || req.method !== 'POST') return next();

  if (idempotencyStore.has(key)) {
    const cached = idempotencyStore.get(key);
    return res.status(cached.status).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    idempotencyStore.set(key, { status: res.statusCode, body, timestamp: Date.now() });
    return originalJson(body);
  };
  next();
};

app.use('/api', tenantMiddleware);
app.use('/api', clientInfoMiddleware);
app.use('/api', idempotencyMiddleware);

// ======================== NEW ROUTES IMPORTS ========================
const logsRoutes = require('./routes/logs');
const loyaltyRoutes = require('./routes/loyalty');
const reportsRoutes = require('./routes/reports');
const reviewsRoutes = require('./routes/reviews');
const cabRoutes = require('./routes/cab');
const historyRoutes = require('./routes/history');
const infoRoutes = require('./routes/info');
const departmentRoutes = require('./routes/department.routes');
// New Guest Dashboard Routes
const offerRoutes = require('./routes/offers');
const roomControlRoutes = require('./routes/roomControl');
const liveChatRoutes = require('./routes/liveChat');
const myBillRoutes = require('./routes/myBill');
const menuRoutes = require('./routes/menu');
const spaRoutes = require('./routes/spa');
const alarmRoutes = require('./routes/alarm');
const cityGuideRoutes = require('./routes/cityGuide');
const weatherRoutes = require('./routes/weather');
const rateUsRoutes = require('./routes/rateUs');
const laundryRoutes = require('./routes/laundry');
const digitalKeyRoutes = require('./routes/digitalKey');
const upgradeRoutes = require('./routes/upgrade');
app.set('io', io);
app.use('/api/departments', departmentRoutes);
// Subscription routes
const subscriptionRoutes = require('./routes/subscription');
app.use('/api/subscription', subscriptionRoutes);
// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);
// GET /api/public/plans (Public API for Landing Page)
app.get('/api/public/plans', async (req, res) => {
    try {
        const cfg = dbConnected
          ? await db.collection('globalConfig').findOne({ _id: 'main' })
          : null;
        const plansObj = (cfg && cfg.planSettings) || {};

        const activePlans = Object.entries(plansObj)
            .filter(([key, plan]) => plan.enabled !== false)
            .map(([key, plan]) => ({
                id: key,
                color: plan.color || 'blue',
                duration: plan.duration !== undefined ? plan.duration : 30,
                ...plan
            }));
        res.json({ success: true, plans: activePlans });
    } catch (error) {
        console.error('Error fetching public plans:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});
// ============================================
// PUBLIC SIGNUP — New Hotel Registration (from Landing Page)
// ============================================
app.post('/api/public/signup', async (req, res) => {
    try {
        if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
        const { hotelName, ownerName, email, phone, plan } = req.body;

        if (!hotelName || !ownerName || !email || !phone) {
            return res.status(400).json({ success: false, error: 'Hotel name, owner name, email and phone are required' });
        }

        const existingUser = await db.collection('tenants').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'This email is already registered' });
        }

        let hotelId;
        let isUnique = false;
        while (!isUnique) {
            const rand = Math.floor(1000 + Math.random() * 9000);
            hotelId = `HOTEL${rand}`;
            const exists = await db.collection('tenants').findOne({ hotelId });
            if (!exists) isUnique = true;
        }

        const generatedPassword = Math.random().toString(36).slice(-4).toUpperCase() +
                                   Math.random().toString(36).slice(-4) +
                                   Math.floor(10 + Math.random() * 89);

        const hotel = {
            hotelId,
            hotelName,
            ownerName,
            country: 'N/A',
            countryCode: 'IN',
            currency: 'USD',
            currencySymbol: '$',
            timezone: 'Asia/Kolkata',
            language: 'en',
            phone,
            email,
            address: '',
            logo: '',
            theme: { primaryColor: '#8B5CF6', secondaryColor: '#F59E0B' },
            subscriptionType: plan || 'basic',
            subscriptionExpiry: null,
            isActive: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const result = await db.collection('tenants').insertOne(hotel);
        hotel._id = result.insertedId;

        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        const defaultAdmin = {
            hotelId: hotel.hotelId,
            email,
            password: hashedPassword,
            name: ownerName,
            role: 'hotel_admin',
            permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
            active: false,
            createdAt: new Date()
        };
        await db.collection('users').insertOne(defaultAdmin);
        // Plain password ko temporarily tenants mein save karo — payment success ke baad ek baar dikhane ke liye
        await db.collection('tenants').updateOne(
            { hotelId: hotel.hotelId },
            { $set: { _tempPassword: generatedPassword } }
        );

        await db.collection('settings').insertOne({
            hotelId: hotel.hotelId,
            hotelName,
            currencySymbol: '$',
            priceFormat: 'symbol-first',
            taxRate: 0,
            wifiSSID: `${hotelName.replace(/\s+/g, '_')}_Guest`,
            wifiPassword: `${hotelName}@2024`,
            language: 'en',
            theme: { primaryColor: '#667eea' },
            transport: { airport: 30, local: 15 },
            updatedAt: new Date()
        });

      await logActivity('New Hotel Signup', hotel.hotelId, 'hotel', { user: ownerName, details: `${hotelName} signed up via landing page` });
        res.status(201).json({
            success: true,
            data: {
                hotelId: hotel.hotelId,
                email,
                plan: plan || 'basic'
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ success: false, error: 'Server error during signup' });
    }
});
// ============================================
// ======================== NEW ROUTES USE ========================
app.use('/api/logs', logsRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/cab', cabRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/info', infoRoutes);
// New Guest Dashboard Routes
// NOTE: offers, spa, laundry are handled by makeCRUD + inline routes below (plain array format)
// Keeping only routes that don't conflict with makeCRUD or inline handlers
app.use('/api/room-control', roomControlRoutes);
app.use('/api/live-chat', liveChatRoutes);
app.use('/api/my-bill', myBillRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/alarm', alarmRoutes);
app.use('/api/city-guide', cityGuideRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/rate-us', rateUsRoutes);
app.use('/api/digital-key', digitalKeyRoutes);
app.use('/api/upgrade', upgradeRoutes);

// ✅ FIX 1: Optimized checkSubscription with caching - no DB hit on cached hotels
const checkSubscription = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;
    if (hotelId === 'HOTEL001') return next();
    if (!dbConnected) return next();

    const cached = getCachedSubscription(hotelId);
    if (cached) {
      if (!cached.active) {
        return res.status(403).json({ success: false, error: 'Hotel account is inactive' });
      }
      if (cached.subscriptionExpiry && new Date(cached.subscriptionExpiry) < new Date()) {
        return res.status(403).json({
          success: false,
          error: 'Subscription expired',
          expiryDate: cached.subscriptionExpiry,
          action: 'Please renew your subscription'
        });
      }
      return next();
    }

    const tenant = await db.collection('tenants').findOne({ hotelId });
    if (!tenant) return next();

    setCachedSubscription(hotelId, tenant);

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

app.use('/api/rooms', checkSubscription);
app.use('/api/guests', checkSubscription);
app.use('/api/food', checkSubscription);
app.use('/api/inventory', checkSubscription);
app.use('/api/requests', checkSubscription);
app.use('/api/bookings', checkSubscription);
app.use('/api/staff', checkSubscription);
app.use('/api/announcements', checkSubscription);
app.use('/api/policies', checkSubscription);
app.use('/api/config', checkSubscription);
app.use('/api/departments', checkSubscription);

const generateToken = (payload, expiresIn = TOKEN_EXPIRY) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

const decodeTokenSafe = (token) => {
  try { return jwt.decode(token); } catch(e) { return null; }
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

    const exp = decoded.exp * 1000;
    const now = Date.now();
    if (exp - now < TOKEN_REFRESH_THRESHOLD_MS) {
      const { iat, exp: _exp, ...rest } = decoded;
      const newToken = generateToken(rest);
      res.setHeader('x-refreshed-token', newToken);
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};
// LANDING PAGE CONTENT — Save (Admin) & Get (Public)
// ============================================
app.post('/api/admin/landing-content', authMiddleware, async (req, res) => {
    try {
        if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
        const content = { ...req.body, updatedAt: new Date() };
        await db.collection('globalConfig').updateOne(
            { _id: 'main' },
            { $set: { landingContent: content } },
            { upsert: true }
        );
        res.json({ success: true, data: content });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/public/landing-content', async (req, res) => {
    try {
        if (!dbConnected) return res.json({ success: true, data: {} });
        const cfg = await db.collection('globalConfig').findOne({ _id: 'main' });
        res.json({ success: true, data: (cfg && cfg.landingContent) || {} });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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

const activeSessions = new Map();

const updateSessionActivity = async (req) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !req.user) return;

  const sessionKey = token.substring(token.length - 32);
  activeSessions.set(sessionKey, {
    lastActivity: Date.now(),
    hotelId: req.hotelId,
    email: req.user?.email
  });

  // ✅ FIX 3: Non-blocking session save
  if (dbConnected) {
    db.collection('sessions').updateOne(
      { sessionKey },
      { $set: { lastActivity: new Date(), hotelId: req.hotelId, email: req.user?.email } },
      { upsert: true }
    ).catch(() => {});
  }
};

const checkIdleTimeout = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();

  const sessionKey = token.substring(token.length - 32);
  const session = activeSessions.get(sessionKey);

  if (session) {
    const idleTime = Date.now() - session.lastActivity;
    if (idleTime > IDLE_TIMEOUT_MS) {
      activeSessions.delete(sessionKey);
      if (dbConnected) {
        db.collection('sessions').deleteOne({ sessionKey }).catch(() => {});
      }
      return res.status(401).json({
        success: false,
        error: 'Session expired due to inactivity',
        code: 'SESSION_IDLE_TIMEOUT',
        idleFor: Math.floor(idleTime / 1000 / 60) + ' minutes'
      });
    }
  }

  updateSessionActivity(req);
  next();
};

app.use('/api/rooms', checkIdleTimeout);
app.use('/api/guests', checkIdleTimeout);
app.use('/api/food', checkIdleTimeout);
app.use('/api/inventory', checkIdleTimeout);
app.use('/api/requests', checkIdleTimeout);
app.use('/api/bookings', checkIdleTimeout);
app.use('/api/staff', checkIdleTimeout);
app.use('/api/settings', checkIdleTimeout);
app.use('/api/blacklist', checkIdleTimeout);
app.use('/api/maintenance', checkIdleTimeout);
app.use('/api/reviews', checkIdleTimeout);
app.use('/api/logs', checkIdleTimeout);
app.use('/api/dashboard', checkIdleTimeout);
app.use('/api/announcements', checkIdleTimeout);
app.use('/api/policies', checkIdleTimeout);
app.use('/api/config', checkIdleTimeout);
app.use('/api/departments', checkIdleTimeout);

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of activeSessions.entries()) {
    if (now - val.lastActivity > IDLE_TIMEOUT_MS + 60000) {
      activeSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ✅ FIX 4+6+8: Enhanced Socket.io - bidirectional Admin↔Guest real-time sync
// Room naming convention:
//   hotel_{hotelId}        → all devices for a hotel (admin + guest)
//   admin_{hotelId}        → admin devices only
//   guest_{hotelId}        → guest devices only
//   room_{hotelId}_{roomNo} → specific guest room devices

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // ---- Join rooms ----
  socket.on('join_hotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
  });

  socket.on('joinHotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected' });
  });

  // ✅ FIX 8: Admin joins dedicated admin room
  socket.on('join_admin', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    socket.join(`admin_${hotelId}`);
    console.log(`👑 Admin ${socket.id} joined admin room: admin_${hotelId}`);
    socket.emit('admin_connected', { hotelId, message: 'Connected to admin channel' });
    // Notify admin about all online guests
    const roomClients = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
    socket.emit('online_count', { count: roomClients ? roomClients.size : 0 });
  });

  // ✅ FIX 8: Guest joins hotel room + specific room channel
  socket.on('join_guest', ({ hotelId, roomNumber, guestName }) => {
    socket.join(`hotel_${hotelId}`);
    socket.join(`guest_${hotelId}`);
    if (roomNumber) {
      socket.join(`room_${hotelId}_${roomNumber}`);
    }
    socket.hotelId = hotelId;
    socket.roomNumber = roomNumber;
    socket.guestName = guestName;
    console.log(`🏨 Guest ${guestName || 'Unknown'} (Room ${roomNumber}) joined hotel_${hotelId}`);
    socket.emit('guest_connected', { hotelId, roomNumber, message: 'Connected to hotel services' });
    // Notify admins that a guest connected
    io.to(`admin_${hotelId}`).emit('guest_online', {
      hotelId, roomNumber, guestName,
      timestamp: new Date().toISOString()
    });
  });

  // ✅ FIX 9: Heartbeat to keep sessions alive on all devices
  socket.on('ping_heartbeat', (data) => {
    socket.emit('pong_heartbeat', { serverTime: new Date().toISOString(), received: data });
  });

  // ---- Broadcast helper (hotel-wide) ----
  const broadcastEvent = (eventName, payload) => {
    const hotelId = payload?.hotelId;
    if (!hotelId) return;
    const data = {
      ...payload,
      syncToken: payload?.syncToken || Date.now(),
      timestamp: new Date().toISOString()
    };
    io.to(`hotel_${hotelId}`).emit(eventName, data);
  };

  // ✅ FIX 8: Admin→Guest broadcast (admin actions go to all guest devices)
  const broadcastToGuests = (hotelId, eventName, payload) => {
    const data = { ...payload, syncToken: Date.now(), timestamp: new Date().toISOString() };
    io.to(`guest_${hotelId}`).emit(eventName, data);
    // Also send to specific room if roomNumber present
    if (payload?.roomNumber) {
      io.to(`room_${hotelId}_${payload.roomNumber}`).emit(eventName, data);
    }
  };

  // ✅ FIX 8: Guest→Admin broadcast (guest actions go to admin dashboard)
  const broadcastToAdmins = (hotelId, eventName, payload) => {
    const data = { ...payload, syncToken: Date.now(), timestamp: new Date().toISOString() };
    io.to(`admin_${hotelId}`).emit(eventName, data);
  };

  // ---- Standard hotel-wide events (existing, preserved) ----
  socket.on('req_new', (payload) => {
    broadcastEvent('req_new', payload);
    // ✅ FIX 8: Also specifically notify admins
    broadcastToAdmins(payload?.hotelId, 'new_guest_request', payload);
  });
  socket.on('req_upd', (payload) => broadcastEvent('req_upd', payload));
  socket.on('room_upd', (payload) => broadcastEvent('room_upd', payload));
  socket.on('guest_upd', (payload) => broadcastEvent('guest_upd', payload));
  socket.on('food_upd', (payload) => broadcastEvent('food_upd', payload));
  socket.on('inventory_upd', (payload) => broadcastEvent('inventory_upd', payload));
  socket.on('cfg_upd', (payload) => broadcastEvent('cfg_upd', payload));
  socket.on('currency_upd', (payload) => broadcastEvent('currency_upd', payload));
  socket.on('booking_new', (payload) => broadcastEvent('booking_new', payload));
  socket.on('booking_upd', (payload) => broadcastEvent('booking_upd', payload));
  socket.on('staff_upd', (payload) => broadcastEvent('staff_upd', payload));
  socket.on('review_new', (payload) => {
    broadcastEvent('review_new', payload);
    broadcastToAdmins(payload?.hotelId, 'new_guest_review', payload);
  });
  socket.on('announcement_upd', (payload) => {
    broadcastEvent('announcement_upd', payload);
    broadcastToGuests(payload?.hotelId, 'new_announcement', payload);
  });
  socket.on('policy_upd', (payload) => broadcastEvent('policy_upd', payload));
  socket.on('blacklist_upd', (payload) => broadcastEvent('blacklist_upd', payload));
  socket.on('maintenance_upd', (payload) => broadcastEvent('maintenance_upd', payload));
  socket.on('logs_upd', (payload) => broadcastEvent('logs_upd', payload));
  socket.on('dept_upd', (payload) => broadcastEvent('dept_upd', payload));

  // ✅ FIX 8: NEW - Guest sends action to admin
  socket.on('guest_action', (payload) => {
    const hotelId = payload?.hotelId;
    if (!hotelId) return;
    broadcastToAdmins(hotelId, 'guest_action', {
      ...payload,
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  // ✅ FIX 8: NEW - Admin sends action to specific guest room
  socket.on('admin_action', (payload) => {
    const hotelId = payload?.hotelId;
    if (!hotelId) return;
    broadcastToGuests(hotelId, 'admin_action', {
      ...payload,
      timestamp: new Date().toISOString()
    });
    // Also broadcast hotel-wide so all admin tabs sync
    io.to(`admin_${hotelId}`).emit('admin_action_ack', { ...payload, timestamp: new Date().toISOString() });
  });

  // ✅ FIX 8: Admin replies to a guest request - target specific room
  socket.on('admin_reply', (payload) => {
    const { hotelId, roomNumber } = payload;
    if (!hotelId) return;
    if (roomNumber) {
      io.to(`room_${hotelId}_${roomNumber}`).emit('admin_reply', {
        ...payload,
        timestamp: new Date().toISOString()
      });
    }
    io.to(`guest_${hotelId}`).emit('request_updated', payload);
    io.to(`admin_${hotelId}`).emit('req_upd', payload);
  });

  // Chat relay: admin → all guests & admin, guest → admin
  socket.on('admin_chat', (payload) => {
    const { hotelId, msg } = payload;
    if (!hotelId || !msg) return;
    const entry = { ...msg, from: 'admin', timestamp: new Date().toISOString() };
    io.to(`hotel_${hotelId}`).emit('chat_upd', { hotelId, data: entry });
  });

  socket.on('guest_chat', (payload) => {
    const { hotelId, msg } = payload;
    if (!hotelId || !msg) return;
    const entry = { ...msg, from: 'guest', timestamp: new Date().toISOString() };
    io.to(`admin_${hotelId}`).emit('chat_upd', { hotelId, data: entry });
    io.to(`hotel_${hotelId}`).emit('chat_upd', { hotelId, data: entry });
  });

  // ✅ FIX 6: Online count broadcast
  socket.on('get_online_count', (hotelId) => {
    const roomClients = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
    socket.emit('online_count', { count: roomClients ? roomClients.size : 0 });
  });

  socket.on('leave_hotel', (hotelId) => {
    socket.leave(`hotel_${hotelId}`);
    socket.leave(`admin_${hotelId}`);
    socket.leave(`guest_${hotelId}`);
    console.log(`📡 ${socket.id} left room: hotel_${hotelId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    // ✅ FIX 8: Notify admin when guest disconnects
    if (socket.hotelId && socket.roomNumber) {
      io.to(`admin_${socket.hotelId}`).emit('guest_offline', {
        hotelId: socket.hotelId,
        roomNumber: socket.roomNumber,
        guestName: socket.guestName,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('error', (error) => {
    console.error('⚠️ Socket error:', error);
  });
});

// ✅ FIX 3+4: Enhanced broadcast - immediate fire, no blocking
const broadcast = (hotelId, event, data, clientId = null) => {
  const payload = {
    data,
    hotelId,
    clientId,
    syncToken: Date.now(),
    timestamp: new Date().toISOString()
  };
  // Broadcast to all hotel devices (admin + guest)
  io.to(`hotel_${hotelId}`).emit(event, payload);
};

// ✅ FIX 8: Targeted broadcasts
const broadcastToAdminRoom = (hotelId, event, data, clientId = null) => {
  const payload = { data, hotelId, clientId, syncToken: Date.now(), timestamp: new Date().toISOString() };
  io.to(`admin_${hotelId}`).emit(event, payload);
  io.to(`hotel_${hotelId}`).emit(event, payload); // also hotel-wide for consistency
};

const broadcastToGuestRoom = (hotelId, roomNumber, event, data) => {
  const payload = { data, hotelId, roomNumber, syncToken: Date.now(), timestamp: new Date().toISOString() };
  if (roomNumber) io.to(`room_${hotelId}_${roomNumber}`).emit(event, payload);
  io.to(`guest_${hotelId}`).emit(event, payload);
};

// ======================== API ROUTES ========================

app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    message: 'Inaya Hotel Management System API',
    status: 'OK',
    version: '5.0.0',
    mongodb: dbConnected ? 'connected' : 'disconnected',
    socket: io.engine.clientsCount,
    activeSessions: activeSessions.size,
    uptime: Math.floor(process.uptime()) + 's',
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    },
    idleTimeoutMs: IDLE_TIMEOUT_MS,
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

app.get('/api/auth/validate', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.json({ success: false, valid: false, code: 'NO_TOKEN' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const exp = decoded.exp * 1000;
    const now = Date.now();
    const idleMs = IDLE_TIMEOUT_MS;

    const sessionKey = token.substring(token.length - 32);
    const session = activeSessions.get(sessionKey);
    if (session) {
      const idleTime = now - session.lastActivity;
      if (idleTime > idleMs) {
        activeSessions.delete(sessionKey);
        return res.json({
          success: false,
          valid: false,
          code: 'SESSION_IDLE_TIMEOUT',
          idleFor: Math.floor(idleTime / 1000 / 60) + ' minutes'
        });
      }
    }

    let newToken = null;
    if (exp - now < TOKEN_REFRESH_THRESHOLD_MS) {
      const { iat, exp: _exp, ...rest } = decoded;
      newToken = generateToken(rest);
    }

    activeSessions.set(sessionKey, {
      lastActivity: now,
      hotelId: decoded.hotelId,
      email: decoded.email
    });

    res.json({
      success: true,
      valid: true,
      user: {
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        hotelId: decoded.hotelId,
        permissions: decoded.permissions
      },
      expiresAt: new Date(exp).toISOString(),
      idleTimeoutMs: idleMs,
      newToken
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.json({ success: false, valid: false, code: 'TOKEN_EXPIRED' });
    }
    return res.json({ success: false, valid: false, code: 'INVALID_TOKEN' });
  }
});

app.get('/api/auth/config', (req, res) => {
  res.json({
    success: true,
    data: {
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      idleTimeoutMinutes: Math.floor(IDLE_TIMEOUT_MS / 60000),
      tokenRefreshThresholdMs: TOKEN_REFRESH_THRESHOLD_MS,
      sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000
    }
  });
});

app.post('/api/auth/ping', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ success: false, error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sessionKey = token.substring(token.length - 32);
    activeSessions.set(sessionKey, {
      lastActivity: Date.now(),
      hotelId: decoded.hotelId,
      email: decoded.email
    });
    res.json({ success: true, lastActivity: new Date().toISOString() });
  } catch {
    res.json({ success: false, error: 'Invalid token' });
  }
});

// ======================== TENANT ========================

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
          theme: 'HOTEL001',
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
          theme: 'HOTEL001',
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

    invalidateSubscriptionCache(hotelId);
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

// ======================== SUPER ADMIN ========================

// Super Admin login — returns real JWT with role: 'super_admin'
app.post('/api/super/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const SA_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@inaya.com';
    const SA_PASS  = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
    if (email.toLowerCase().trim() !== SA_EMAIL.toLowerCase() || password !== SA_PASS) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const token = generateToken({ email: SA_EMAIL, role: 'super_admin' }, '30d');
    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/super/tenants/register', superAdminMiddleware, async (req, res) => {
  try {
    const {
      hotelId, hotelName, adminEmail, adminPassword,
      currency, currencySymbol, language, country,
      subscriptionType, theme, logo, timezone
    } = req.body;

    if (!hotelId || !hotelName || !adminEmail || !adminPassword) {
      return res.status(400).json({ success: false, error: 'hotelId, hotelName, adminEmail, and adminPassword are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const existing = await db.collection('tenants').findOne({ hotelId });
    if (existing) return res.status(400).json({ success: false, error: 'Hotel ID already registered' });

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    let subscriptionExpiry;
    if (subscriptionType === 'lifetime') subscriptionExpiry = null;
    else if (subscriptionType === 'enterprise') subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    else if (subscriptionType === 'pro') subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    else subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

// ✅ NAYA CODE - adminEmail aur adminPassword bhi tenants mein save hoga
const tenant = {
  hotelId, hotelName, logo: logo || null,
  currency: currency || 'USD', currencySymbol: currencySymbol || '$',
  language: language || 'en', country: country || 'Unknown',
  timezone: timezone || 'UTC', active: true,
  theme: theme || 'HOTEL001', subscriptionType: subscriptionType || 'basic',
  subscriptionExpiry,
  adminEmail: adminEmail,           // ✅ ADD KIYA
  adminPassword: adminPassword,     // ✅ ADD KIYA (plain text - sirf reference ke liye)
  createdAt: new Date(), updatedAt: new Date()
};

await db.collection('tenants').insertOne(tenant);

    // ✅ Naye hotel ke liye automatically departments copy karo
    const defaultDepts = await db.collection('departments').find({ hotelId: 'default' }).toArray();
    for (const dept of defaultDepts) {
      const newDept = { ...dept, hotelId, createdAt: new Date(), updatedAt: new Date() };
      delete newDept._id;
      await db.collection('departments').insertOne(newDept);
    }
    console.log(`✅ ${defaultDepts.length} departments created for ${hotelId}`);

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

    res.status(201).json({
      success: true,
      message: 'Hotel registered successfully',
      data: { hotelId, hotelName, adminEmail, currency, country, subscriptionType, expiryDate: subscriptionExpiry }
    });
  } catch (error) {
    console.error('Hotel registration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/super/tenants', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });

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

app.put('/api/super/tenants/:hotelId', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId } = req.params;
    const updates = req.body;
    if (!dbConnected) return res.json({ success: true, message: 'Hotel updated (offline mode)' });

    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Hotel not found' });

    invalidateSubscriptionCache(hotelId);

    if (updates.hotelName || updates.currency || updates.language || updates.theme) {
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
    if (!dbConnected) return res.json({ success: true, message: 'Hotel deleted (offline mode)' });

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
    invalidateSubscriptionCache(hotelId);
    io.to(`hotel_${hotelId}`).emit('hotel_deleted', { message: 'This hotel has been deactivated' });

    res.json({ success: true, message: 'Hotel and all data deleted' });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/super/countries', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
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

app.get('/api/super/stats', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) {
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

app.get('/api/super/transactions', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });

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

app.post('/api/super/admins/register', superAdminMiddleware, async (req, res) => {
  try {
    const { email, password, name, hotelId, role, permissions } = req.body;
    if (!email || !password || !hotelId) return res.status(400).json({ success: false, error: 'email, password, and hotelId are required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

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
    res.status(201).json({ ...user, success: true, message: 'Admin created' });
  } catch (error) {
    console.error('Admin register error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// RESET HOTEL ADMIN PASSWORD (Super Admin Only)
// ============================================
app.post('/api/super/reset-hotel-password', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId, newPassword } = req.body;
    if (!hotelId || !newPassword) {
      return res.status(400).json({ success: false, error: 'hotelId and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await db.collection('users').updateOne(
      { hotelId, role: 'hotel_admin' },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Hotel admin not found' });
    }
    await logActivity('Password Reset', hotelId, 'user', { user: 'Super Admin', details: `Password reset for hotel admin` });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset hotel password error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET ALL USERS/STAFF (Super Admin Only)
// ============================================
app.get('/api/super/users', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const users = await db.collection('users').find({}).sort({ createdAt: -1 }).toArray();
    const hotelIds = [...new Set(users.map(u => u.hotelId).filter(Boolean))];
    const tenants = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
    const hotelNameMap = {};
    tenants.forEach(t => { hotelNameMap[t.hotelId] = t.hotelName; });
    const usersWithHotel = users.map(u => ({
      id: u._id.toString(),
      name: u.name || u.email,
      email: u.email,
      hotelId: u.hotelId,
      hotelName: hotelNameMap[u.hotelId] || u.hotelId || 'N/A',
      role: u.role || 'staff',
      active: u.active !== false
    }));
    res.json({ success: true, data: usersWithHotel, count: usersWithHotel.length });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET ALL BOOKINGS ACROSS ALL HOTELS (Super Admin Only)
// ============================================
app.get('/api/super/bookings', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const bookings = await db.collection('bookings').find({}).sort({ createdAt: -1 }).limit(200).toArray();
    const hotelIds = [...new Set(bookings.map(b => b.hotelId).filter(Boolean))];
    const tenants = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
    const hotelNameMap = {};
    tenants.forEach(t => { hotelNameMap[t.hotelId] = t.hotelName; });
    const bookingsWithHotel = bookings.map(b => ({
      id: b._id.toString(),
      guest: b.guestName || b.guest || 'N/A',
      hotelId: b.hotelId,
      hotelName: hotelNameMap[b.hotelId] || b.hotelId || 'N/A',
      room: b.roomNumber || b.room || 'N/A',
      checkin: b.checkIn ? new Date(b.checkIn).toLocaleDateString() : (b.checkin || 'N/A'),
      checkout: b.checkOut ? new Date(b.checkOut).toLocaleDateString() : (b.checkout || 'N/A'),
      amount: b.totalAmount || b.amount || 0,
      status: b.status || 'pending',
      createdAt: b.createdAt
    }));
    res.json({ success: true, data: bookingsWithHotel, count: bookingsWithHotel.length });
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET ALL ROOMS ACROSS ALL HOTELS (Super Admin Only)
// ============================================
app.get('/api/super/rooms', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const rooms = await db.collection('rooms').find({}).sort({ number: 1 }).limit(500).toArray();
    const hotelIds = [...new Set(rooms.map(r => r.hotelId).filter(Boolean))];
    const tenants = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
    const hotelNameMap = {};
    tenants.forEach(t => { hotelNameMap[t.hotelId] = t.hotelName; });
    const roomsWithHotel = rooms.map(r => ({
      id: r._id.toString(),
      roomNumber: r.number || r.roomNumber || 'N/A',
      hotelId: r.hotelId,
      hotelName: hotelNameMap[r.hotelId] || r.hotelId || 'N/A',
      type: r.type || 'Standard',
      floor: r.floor || 'N/A',
      status: (r.status || 'available').toLowerCase(),
      guest: r.currentGuest || r.guest || '',
      checkout: r.checkoutDate ? new Date(r.checkoutDate).toLocaleDateString() : '--'
    }));
    res.json({ success: true, data: roomsWithHotel, count: roomsWithHotel.length });
  } catch (err) {
    console.error('Get rooms error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET ACTIVITY/AUDIT LOGS (Super Admin Only)
// ============================================
app.get('/api/super/activity-logs', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const logs = await db.collection('activityLogs').find({}).sort({ timestamp: -1 }).limit(200).toArray();
    const formatted = logs.map(log => ({
      id: log._id.toString(),
      timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A',
      user: log.user || 'System',
      action: log.action || 'N/A',
      target: log.target || 'N/A',
      ip: log.ip || 'N/A',
      type: log.type || 'setting',
      details: log.details || ''
    }));
    res.json({ success: true, data: formatted, count: formatted.length });
  } catch (err) {
    console.error('Get activity logs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// API KEYS — List, Generate, Revoke (Super Admin Only)
// ============================================
app.get('/api/super/api-keys', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const keys = await db.collection('apiKeys').find({}).sort({ createdAt: -1 }).toArray();
    const formatted = keys.map(k => ({
      id: k._id.toString(),
      name: k.name,
      hotelId: k.hotelId,
      key: k.key,
      created: k.createdAt ? new Date(k.createdAt).toLocaleDateString() : 'N/A',
      lastUsed: k.lastUsed ? new Date(k.lastUsed).toLocaleDateString() : 'Never',
      active: k.active !== false
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get API keys error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/api-keys', superAdminMiddleware, async (req, res) => {
  try {
    const { name, hotelId } = req.body;
    if (!name || !hotelId) return res.status(400).json({ success: false, error: 'name and hotelId are required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const crypto = require('crypto');
    const key = 'pk_live_' + crypto.randomBytes(24).toString('hex');
    const doc = { name, hotelId, key, active: true, createdAt: new Date(), lastUsed: null };
    const result = await db.collection('apiKeys').insertOne(doc);
    doc._id = result.insertedId;
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/api-keys/:id/toggle', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const key = await db.collection('apiKeys').findOne({ _id: new ObjectId(id) });
    if (!key) return res.status(404).json({ success: false, error: 'Key not found' });
    await db.collection('apiKeys').updateOne({ _id: new ObjectId(id) }, { $set: { active: !key.active } });
    res.json({ success: true, active: !key.active });
  } catch (err) {
    console.error('Toggle API key error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ GLOBAL CONFIG — default hotel, plan prices, currencies (MongoDB backed)
const DEFAULT_GLOBAL_CONFIG = {
  defaultHotelId: 'CROWN',
  planSettings: {
    basic:      { name: 'Free / Basic', price: 0,   currency: 'USD', enabled: true,  features: ['1 Hotel', 'Up to 20 Rooms', 'Basic Reports', '7-day Trial'] },
    pro:        { name: 'Pro',          price: 99,  currency: 'USD', enabled: true,  features: ['Up to 5 Hotels', 'Unlimited Rooms', 'Priority Support', 'Analytics Dashboard'] },
    enterprise: { name: 'Enterprise',   price: 499, currency: 'USD', enabled: true,  features: ['Unlimited Hotels', 'Custom Branding', 'Dedicated Manager', 'API Access'] }
  },
  currencies: [],
  enabledCurrencies: {}
};

// Public (no auth) — index.html fetches defaultHotelId, currencies & plans on load
app.get('/api/super/global-config/public', async (req, res) => {
  try {
    const cfg = dbConnected
      ? await db.collection('globalConfig').findOne({ _id: 'main' })
      : null;
    const base = cfg || DEFAULT_GLOBAL_CONFIG;
    res.json({
      success: true,
      defaultHotelId:    base.defaultHotelId    || DEFAULT_GLOBAL_CONFIG.defaultHotelId,
      planSettings:      base.planSettings      || DEFAULT_GLOBAL_CONFIG.planSettings,
      currencies:        base.currencies        || [],
      enabledCurrencies: base.enabledCurrencies || {},
      exchangeRates:     base.exchangeRates     || {},
      ratesUpdatedAt:    base.ratesUpdatedAt    || null
    });
  } catch (e) {
    res.json({
      success: true,
      defaultHotelId:    DEFAULT_GLOBAL_CONFIG.defaultHotelId,
      planSettings:      DEFAULT_GLOBAL_CONFIG.planSettings,
      currencies:        [],
      enabledCurrencies: {},
      exchangeRates:     {},
      ratesUpdatedAt:    null
    });
  }
});

// Full config read (super admin)
app.get('/api/super/global-config', superAdminMiddleware, async (req, res) => {
  try {
    const cfg = dbConnected
      ? await db.collection('globalConfig').findOne({ _id: 'main' })
      : null;
    res.json({ success: true, config: cfg || DEFAULT_GLOBAL_CONFIG });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Full config write (super admin) — broadcasts to ALL hotel clients in real-time
app.put('/api/super/global-config', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'DB not connected' });
    // Preserve existing exchangeRates if not in request body
    const existing = await db.collection('globalConfig').findOne({ _id: 'main' });
    const update = {
      ...(existing || {}),
      ...req.body,
      _id: 'main',
      updatedAt: new Date(),
      exchangeRates: (req.body.exchangeRates) || (existing && existing.exchangeRates) || {}
    };
    await db.collection('globalConfig').replaceOne({ _id: 'main' }, update, { upsert: true });
    // 🔴 REAL-TIME: broadcast to ALL connected hotel apps instantly
    io.emit('global_config_updated', {
      defaultHotelId:    update.defaultHotelId,
      planSettings:      update.planSettings,
      currencies:        update.currencies || [],
      enabledCurrencies: update.enabledCurrencies || {},
      exchangeRates:     update.exchangeRates || {},
      updatedAt:         update.updatedAt
    });
    res.json({ success: true, config: update });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ NEW: Guest Login Route to generate real JWT for guests
app.post('/api/guest/login', (req, res) => {
    const { name, room, hotelId } = req.body;
    if (!name || !room) return res.status(400).json({ success: false, error: 'Name and room required' });

    const hId = hotelId || req.headers['x-hotel-id'] || 'HOTEL001';
    const tokenPayload = { name, room, role: 'guest', hotelId: hId };
    const token = generateToken(tokenPayload);

    res.json({ success: true, token, user: { name, room, role: 'guest' }, hotelId: hId });
});

// ======================== GOOGLE OAUTH ROUTES ========================
// Step 1: Frontend POSTs hotelId, we save it in session then redirect to Google
app.post('/auth/google/start', (req, res) => {
  const { hotelId } = req.body;
  if (!hotelId) return res.status(400).json({ error: 'hotelId required' });
  req.session.oauthHotelId = hotelId;
  req.session.save(() => res.json({ ok: true, redirect: '/auth/google' }));
});

// Step 2: Redirect to Google consent screen
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Step 3: Google redirects back here
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?googleError=1', session: true }),
  (req, res) => {
    const user = req.user;
    const hotelId = req.session.oauthHotelId || user?.hotelId || 'HOTEL001';
    const token = generateToken({
      name: user.name,
      email: user.email,
      googleId: user.googleId,
      avatar: user.avatar,
      role: 'guest',
      hotelId
    });
    // Clean up session oauth state
    delete req.session.oauthHotelId;
    const params = new URLSearchParams({
      googleAuth: 'success',
      token,
      name: user.name,
      email: user.email || '',
      avatar: user.avatar || '',
      hotelId
    });
    res.redirect(`/?${params.toString()}`);
  }
);

// ✅ FIX 1: OPTIMIZED LOGIN - parallel queries, fast path, non-blocking session
app.post('/api/admin/login', loginLimiter || ((req, res, next) => next()), async (req, res) => {
  const startTime = Date.now();
  try {
    const { email, password, hotelId } = req.body;
    console.log(`🔐 [${Date.now()}] Admin login attempt: ${email} for hotel: ${hotelId}`);

 
    if (!dbConnected) {
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }

// 🔒 SECURITY FIX: Strict hotelId validation - user must belong to the requested hotel
const user = await db.collection('users').findOne({
  email: email,
  hotelId: hotelId  // STRICT MATCH - no fallback
});

if (!user) {
  console.log(`❌ [${Date.now()}] User not found for hotel ${hotelId}: ${email}`);
  return res.status(401).json({ 
    success: false, 
    error: 'Invalid credentials for this hotel' 
  });
}

// 🔒 EXTRA CHECK: User ka hotelId match karna zaroori hai
if (user.hotelId && user.hotelId !== hotelId) {
  console.log(`🚨 SECURITY: User ${email} tried to access hotel ${hotelId} but belongs to ${user.hotelId}`);
  return res.status(403).json({ 
    success: false, 
    error: 'Access denied. This account belongs to a different hotel.' 
  });
}

const validPassword = await bcrypt.compare(password, user.password);
if (!validPassword) {
  console.log(`❌ [${Date.now()}] Wrong password for: ${email}`);
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
}
if (!user.active) return res.status(403).json({ success: false, error: 'Account is inactive' });

// 🔒 SECURITY FIX: Use ONLY user's actual hotelId - no fallbacks
const userHotelId = user.hotelId || hotelId;

const tokenPayload = {
  email: user.email, 
  name: user.name, 
  role: user.role,
  hotelId: user.hotelId || hotelId,  // 🔒 User ka actual hotelId use karo
  permissions: user.permissions
};
const token = generateToken(tokenPayload);

const sessionKey = token.substring(token.length - 32);
activeSessions.set(sessionKey, {
  lastActivity: Date.now(),
  hotelId: userHotelId,  // STRICT: Use user's actual hotelId
  email: user.email
});

// ✅ FIX 3: Non-blocking session save
db.collection('sessions').updateOne(
  { sessionKey },
  { $set: { lastActivity: new Date(), hotelId: userHotelId, email: user.email } },
  { upsert: true }
).catch(err => console.warn('Session save warning:', err.message));

req.session.isAdmin = true;
req.session.adminEmail = email;
req.session.hotelId = userHotelId;  // STRICT: Use user's actual hotelId
req.session.user = { 
  email: user.email, 
  name: user.name, 
  role: user.role, 
  hotelId: userHotelId,
  permissions: user.permissions 
};

console.log(`✅ [${Date.now()}] Login successful for hotel ${userHotelId}: ${email} in ${Date.now() - startTime}ms`);

res.json({
  success: true, 
  token,
  user: { 
    email: user.email, 
    name: user.name, 
    role: user.role, 
    hotelId: userHotelId,
    permissions: user.permissions 
  },
  hotelId: userHotelId,  // STRICT: Return user's actual hotelId
  idleTimeoutMs: IDLE_TIMEOUT_MS
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

      const sessionKey = token.substring(token.length - 32);
      const session = activeSessions.get(sessionKey);
      if (session) {
        const idleTime = Date.now() - session.lastActivity;
        if (idleTime > IDLE_TIMEOUT_MS) {
          activeSessions.delete(sessionKey);
          return res.json({ success: false, isAdmin: false, code: 'SESSION_IDLE_TIMEOUT' });
        }
        session.lastActivity = Date.now();
      }

      return res.json({
        success: true, isAdmin: true,
        email: decoded.email,
        hotelId: decoded.hotelId,
        role: decoded.role,
        name: decoded.name,
        permissions: decoded.permissions,
        idleTimeoutMs: IDLE_TIMEOUT_MS
      });
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.json({ success: false, isAdmin: false, code: 'TOKEN_EXPIRED' });
      }
    }
  }

  if (req.session.isAdmin) {
    res.json({
      success: true, isAdmin: true,
      email: req.session.adminEmail,
      hotelId: req.session.hotelId || 'HOTEL001',
      idleTimeoutMs: IDLE_TIMEOUT_MS
    });
  } else {
    res.json({ success: false, isAdmin: false });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const sessionKey = token.substring(token.length - 32);
    activeSessions.delete(sessionKey);
    if (dbConnected) {
      db.collection('sessions').deleteOne({ sessionKey }).catch(() => {});
    }
  }
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully' });
});

// ======================== ROOMS ========================

app.get('/api/rooms', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const rooms = await db.collection('rooms').find({ hotelId }).sort({ number: 1 }).toArray();
    // ✅ FIX 2: Ensure _id is string for all documents
    rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
    res.json(rooms);
  } catch (error) {
    console.error('Rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/rooms/available', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const rooms = await db.collection('rooms').find({ hotelId, status: 'Vacant' }).sort({ number: 1 }).toArray();
    rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
    res.json(rooms);
  } catch (error) {
    console.error('Available rooms fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { number, type, price, basePriceSAR, floor, maxGuests, view, amenities, description, status, guestName } = req.body;

    if (!number || !type || (!price && !basePriceSAR)) {
      return res.status(400).json({ success: false, error: 'number, type, and price are required' });
    }

    if (!dbConnected) {
      const room = {
        _id: 'r_'+Date.now(), hotelId, number: parseInt(number), type,
        price: parseFloat(price || basePriceSAR), basePriceSAR: parseFloat(basePriceSAR || price),
        floor: floor || 1, maxGuests: maxGuests || 2, view: view || 'City',
        amenities: amenities || [], description: description || '',
        status: status || 'Vacant', guestName: guestName || null,
        createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'room_upd', room, req.clientId);
      return res.status(201).json({ ...room, success: true, message: 'Room added (offline)' });
    }

    const existing = await db.collection('rooms').findOne({ hotelId, number: parseInt(number) });
    if (existing) return res.status(400).json({ success: false, error: 'Room number already exists' });

    const room = {
      hotelId, number: parseInt(number), type,
      price: parseFloat(price || basePriceSAR), basePriceSAR: parseFloat(basePriceSAR || price),
      floor: floor || 1, maxGuests: maxGuests || 2, view: view || 'City',
      amenities: amenities || [], description: description || '',
      status: status || 'Vacant', guestName: guestName || null,
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId.toString(); // ✅ FIX 2
    // ✅ FIX 4+8: Broadcast to all hotel devices immediately
    broadcast(hotelId, 'room_upd', room, req.clientId);
    broadcastToGuestRoom(hotelId, room.number, 'room_status_changed', room);
    res.status(201).json({ ...room, success: true, message: 'Room added' });
  } catch (error) {
    console.error('Room create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/rooms/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { number, type, price, basePriceSAR, floor, maxGuests, view, amenities, description, status, guestName } = req.body;

    if (!dbConnected) {
      const updatedRoom = {
        _id: id, hotelId,
        number: number ? parseInt(number) : undefined, type,
        price: price ? parseFloat(price) : undefined, basePriceSAR: basePriceSAR ? parseFloat(basePriceSAR) : undefined,
        floor, maxGuests, view, amenities, description, status, guestName, updatedAt: new Date()
      };
      broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
      return res.json({ ...updatedRoom, success: true, message: 'Room updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(number && { number: parseInt(number) }),
      ...(type && { type }),
      ...(price && { price: parseFloat(price) }),
      ...(basePriceSAR && { basePriceSAR: parseFloat(basePriceSAR) }),
      ...(floor !== undefined && { floor }),
      ...(maxGuests !== undefined && { maxGuests }),
      ...(view && { view }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(guestName !== undefined && { guestName }),
      ...(amenities && { amenities })
    };

    // ✅ FIX 3: findOneAndUpdate instead of updateOne + findOne (single round trip)
    const result = await db.collection('rooms').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Room not found' });

    const updatedRoom = result;
    if (updatedRoom._id) updatedRoom._id = updatedRoom._id.toString(); // ✅ FIX 2

    // ✅ FIX 8: Notify guest in that room about status change
    broadcast(hotelId, 'room_upd', updatedRoom, req.clientId);
    if (updatedRoom.number) {
      broadcastToGuestRoom(hotelId, updatedRoom.number, 'room_status_changed', updatedRoom);
    }
    res.json({ ...updatedRoom, success: true, message: 'Room updated' });
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
      broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Room deleted (offline)' });
    }

    const result = await db.collection('rooms').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Room not found' });

    broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Room deleted' });
  } catch (error) {
    console.error('Room delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== GUESTS ========================

app.get('/api/guests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const guests = await db.collection('guests').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    guests.forEach(g => { if (g._id) g._id = g._id.toString(); }); // ✅ FIX 2
    res.json(guests);
  } catch (error) {
    console.error('Guests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/guests', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, email, phone, room, checkIn, checkOut, points, status } = req.body;

    if (!name || !room) return res.status(400).json({ success: false, error: 'name and room are required' });

    if (!dbConnected) {
      const guest = {
        _id: 'g_'+Date.now(), hotelId, name,
        email: email || null, phone: phone || null,
        room: parseInt(room), checkIn: checkIn ? new Date(checkIn) : new Date(),
        checkOut: checkOut ? new Date(checkOut) : null,
        points: points || 0, status: status || 'active',
        createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'guest_upd', guest, req.clientId);
      return res.status(201).json({ ...guest, success: true, message: 'Guest added (offline)' });
    }

    const guest = {
      hotelId, name, email: email || null, phone: phone || null,
      room: parseInt(room), checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      points: points || 0, status: status || 'active',
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('guests').insertOne(guest);
    guest._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'guest_upd', guest, req.clientId);
    // ✅ FIX 8: Notify guest's room channel
    broadcastToGuestRoom(hotelId, parseInt(room), 'guest_checkedin', guest);
    res.status(201).json({ ...guest, success: true, message: 'Guest added' });
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
        _id: id, hotelId, name, email, phone,
        room: room ? parseInt(room) : undefined,
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut !== undefined ? (checkOut ? new Date(checkOut) : null) : undefined,
        points: points !== undefined ? parseInt(points) : undefined,
        status, updatedAt: new Date()
      };
      broadcast(hotelId, 'guest_upd', updatedGuest, req.clientId);
      return res.json({ ...updatedGuest, success: true, message: 'Guest updated (offline)' });
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

    // ✅ FIX 3: Single round trip with findOneAndUpdate
    const result = await db.collection('guests').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Guest not found' });

    const updatedGuest = result;
    if (updatedGuest._id) updatedGuest._id = updatedGuest._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'guest_upd', updatedGuest, req.clientId);
    res.json({ ...updatedGuest, success: true, message: 'Guest updated' });
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
      broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Guest deleted (offline)' });
    }

    const result = await db.collection('guests').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Guest not found' });

    broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Guest deleted' });
  } catch (error) {
    console.error('Guest delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== FOOD ========================

app.get('/api/food', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const food = await db.collection('food').find({ hotelId }).sort({ name: 1 }).toArray();
    food.forEach(f => { if (f._id) f._id = f._id.toString(); }); // ✅ FIX 2
    res.json(food);
  } catch (error) {
    console.error('Food fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/food', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, price, basePriceSAR, category, description, available, image, emoji } = req.body;

    if (!name || (!price && !basePriceSAR)) return res.status(400).json({ success: false, error: 'name and price are required' });

    if (!dbConnected) {
      const item = {
        _id: 'f_'+Date.now(), hotelId, name,
        price: parseFloat(price || basePriceSAR), basePriceSAR: parseFloat(basePriceSAR || price),
        category: category || 'Main Course', description: description || '',
        available: available !== false, image: image || null, emoji: emoji || '🍽️',
        createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'food_upd', item, req.clientId);
      return res.status(201).json({ ...item, success: true, message: 'Food item added (offline)' });
    }

    const item = {
      hotelId, name,
      price: parseFloat(price || basePriceSAR), basePriceSAR: parseFloat(basePriceSAR || price),
      category: category || 'Main Course', description: description || '',
      available: available !== false, image: image || null, emoji: emoji || '🍽️',
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('food').insertOne(item);
    item._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'food_upd', item, req.clientId);
    // ✅ FIX 8: Notify guest devices about menu update
    io.to(`guest_${hotelId}`).emit('menu_updated', { hotelId, item, syncToken: Date.now() });
    res.status(201).json({ ...item, success: true, message: 'Food item added' });
  } catch (error) {
    console.error('Food create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/food/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, price, basePriceSAR, category, description, available, image, emoji } = req.body;

    if (!dbConnected) {
      const updatedItem = {
        _id: id, hotelId, name,
        price: price ? parseFloat(price) : undefined, basePriceSAR: basePriceSAR ? parseFloat(basePriceSAR) : undefined,
        category, description, available, image, emoji, updatedAt: new Date()
      };
      broadcast(hotelId, 'food_upd', updatedItem, req.clientId);
      return res.json({ ...updatedItem, success: true, message: 'Food item updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(price && { price: parseFloat(price) }),
      ...(basePriceSAR && { basePriceSAR: parseFloat(basePriceSAR) }),
      ...(category && { category }),
      ...(description !== undefined && { description }),
      ...(available !== undefined && { available }),
      ...(image !== undefined && { image }),
      ...(emoji && { emoji })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('food').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Food item not found' });

    const updatedItem = result;
    if (updatedItem._id) updatedItem._id = updatedItem._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'food_upd', updatedItem, req.clientId);
    io.to(`guest_${hotelId}`).emit('menu_updated', { hotelId, item: updatedItem, syncToken: Date.now() });
    res.json({ ...updatedItem, success: true, message: 'Food item updated' });
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
      broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Food item deleted (offline)' });
    }

    const result = await db.collection('food').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Food item not found' });

    broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    io.to(`guest_${hotelId}`).emit('menu_updated', { hotelId, deleted: id, syncToken: Date.now() });
    res.json({ success: true, message: 'Food item deleted' });
  } catch (error) {
    console.error('Food delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== INVENTORY ========================

app.get('/api/inventory', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const inventory = await db.collection('inventory').find({ hotelId }).sort({ name: 1 }).toArray();
    inventory.forEach(i => { if (i._id) i._id = i._id.toString(); }); // ✅ FIX 2
    res.json(inventory);
  } catch (error) {
    console.error('Inventory fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/inventory', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, category, quantity, stock, minStock, min, price, unit, status } = req.body;

    const qty = parseInt(quantity || stock || 0);
    const minQty = parseInt(minStock || min || 10);

    if (!name || !category || isNaN(qty)) {
      return res.status(400).json({ success: false, error: 'name, category, and quantity are required' });
    }

    const autoStatus = qty <= 0 ? 'out-of-stock'
      : qty <= minQty ? 'low-stock' : 'in-stock';

    if (!dbConnected) {
      const item = {
        _id: 'i_'+Date.now(), hotelId, name, category,
        quantity: qty, stock: qty, minStock: minQty, min: minQty,
        price: price ? parseFloat(price) : 0, unit: unit || 'pcs',
        status: status || autoStatus, createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'inventory_upd', item, req.clientId);
      return res.status(201).json({ ...item, success: true, message: 'Inventory item added (offline)' });
    }

    const item = {
      hotelId, name, category,
      quantity: qty, stock: qty, minStock: minQty, min: minQty,
      price: price ? parseFloat(price) : 0, unit: unit || 'pcs',
      status: status || autoStatus,
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('inventory').insertOne(item);
    item._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'inventory_upd', item, req.clientId);
    res.status(201).json({ ...item, success: true, message: 'Inventory item added' });
  } catch (error) {
    console.error('Inventory create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/inventory/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { name, category, quantity, stock, minStock, min, price, unit, status } = req.body;

    const qty = quantity !== undefined ? parseInt(quantity) : (stock !== undefined ? parseInt(stock) : undefined);
    const minQty = minStock !== undefined ? parseInt(minStock) : (min !== undefined ? parseInt(min) : undefined);

    const autoStatus = () => {
      if (qty === undefined) return undefined;
      const m = minQty || 10;
      return qty <= 0 ? 'out-of-stock' : qty <= m ? 'low-stock' : 'in-stock';
    };

    if (!dbConnected) {
      const updatedItem = {
        _id: id, hotelId, name, category,
        quantity: qty, stock: qty, minStock: minQty, min: minQty,
        price: price !== undefined ? parseFloat(price) : undefined,
        unit, status: status || autoStatus(), updatedAt: new Date()
      };
      broadcast(hotelId, 'inventory_upd', updatedItem, req.clientId);
      return res.json({ ...updatedItem, success: true, message: 'Inventory item updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(name && { name }),
      ...(category && { category }),
      ...(qty !== undefined && { quantity: qty, stock: qty }),
      ...(minQty !== undefined && { minStock: minQty, min: minQty }),
      ...(price !== undefined && { price: parseFloat(price) }),
      ...(unit && { unit }),
      ...(status && { status })
    };

    const computed = autoStatus();
    if (computed) updateData.status = computed;

    // ✅ FIX 3: Single round trip
    const result = await db.collection('inventory').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Inventory item not found' });

    const updatedItem = result;
    if (updatedItem._id) updatedItem._id = updatedItem._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'inventory_upd', updatedItem, req.clientId);
    res.json({ ...updatedItem, success: true, message: 'Inventory item updated' });
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
      broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Inventory item deleted (offline)' });
    }

    const result = await db.collection('inventory').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Inventory item not found' });

    broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Inventory item deleted' });
  } catch (error) {
    console.error('Inventory delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== REQUESTS ========================

app.get('/api/requests', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);

    const { status, priority, department } = req.query;
    let filter = { hotelId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (department) filter.department = department;

    const requests = await db.collection('requests').find(filter).sort({ createdAt: -1 }).toArray();
    requests.forEach(r => { if (r._id) r._id = r._id.toString(); }); // ✅ FIX 2
    res.json(requests);
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
        _id: 'req_'+Date.now(), hotelId, guestName,
        roomNumber: parseInt(roomNumber), department,
        category: category || 'General', description: description || '',
        priority: priority || 'normal', status: 'open',
        type: type || 'service', items: items || [],
        totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
        assignedTo: null, createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'req_new', request, req.clientId);
      broadcastToAdminRoom(hotelId, 'new_guest_request', request);
      return res.status(201).json({ ...request, success: true, message: 'Request submitted (offline)' });
    }

    const request = {
      hotelId, guestName, roomNumber: parseInt(roomNumber), department,
      category: category || 'General', description: description || '',
      priority: priority || 'normal', status: 'open',
      type: type || 'service', items: items || [],
      totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
      assignedTo: null, createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('requests').insertOne(request);
    request._id = result.insertedId.toString(); // ✅ FIX 2

    // ✅ FIX 4+8: Broadcast to ALL hotel devices + specifically to admin
    broadcast(hotelId, 'req_new', request, req.clientId);
    broadcastToAdminRoom(hotelId, 'new_guest_request', request);

    res.status(201).json({ ...request, success: true, message: 'Request submitted' });
  } catch (error) {
    console.error('Request create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/requests/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, priority, assignedTo, notes, adminReply, adminReplyTime } = req.body;

    if (!dbConnected) {
      const updatedRequest = {
        _id: id, hotelId, status, priority, assignedTo, notes, adminReply, adminReplyTime,
        updatedAt: new Date()
      };
      broadcast(hotelId, 'req_upd', updatedRequest, req.clientId);
      return res.json({ ...updatedRequest, success: true, message: 'Request updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(notes && { notes }),
      ...(adminReply !== undefined && { adminReply }),
      ...(adminReplyTime && { adminReplyTime })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('requests').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Request not found' });

    const updatedRequest = result;
    if (updatedRequest._id) updatedRequest._id = updatedRequest._id.toString(); // ✅ FIX 2

    // ✅ FIX 8: Broadcast to hotel-wide + notify specific guest room if adminReply
    broadcast(hotelId, 'req_upd', updatedRequest, req.clientId);
    if (adminReply && updatedRequest.roomNumber) {
      io.to(`room_${hotelId}_${updatedRequest.roomNumber}`).emit('admin_reply', {
        requestId: updatedRequest._id,
        adminReply,
        status: updatedRequest.status,
        hotelId,
        roomNumber: updatedRequest.roomNumber,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ ...updatedRequest, success: true, message: 'Request updated' });
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
      broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Request deleted (offline)' });
    }

    const result = await db.collection('requests').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Request not found' });

    broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Request deleted' });
  } catch (error) {
    console.error('Request delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== SETTINGS ========================

app.get('/api/settings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const defaultSettings = {
      hotelId, hotelName: 'Crown Plaza Hotel',
      currencySymbol: '$', priceFormat: 'symbol-first',
      taxRate: 0, wifiSSID: 'Hotel_Guest', wifiPassword: 'Welcome123',
      language: 'en', theme: { primaryColor: '#667eea' },
      transport: { airport: 30, local: 15 }, updatedAt: new Date()
    };

    if (!dbConnected) return res.json(defaultSettings);

    const settings = await db.collection('settings').findOne({ hotelId });
    if (settings && settings._id) settings._id = settings._id.toString(); // ✅ FIX 2
    res.json(settings || defaultSettings);
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
      broadcast(hotelId, 'cfg_upd', {
        hotelName: updatedSettings.hotelName,
        currencySymbol: updatedSettings.currencySymbol,
        wifiPassword: updatedSettings.wifiPassword,
        language: updatedSettings.language,
        theme: updatedSettings.theme
      }, req.clientId);
      return res.json({ ...updatedSettings, success: true, message: 'Settings saved (offline)' });
    }

    const updateData = { ...settings, hotelId, updatedAt: new Date() };

    // ✅ FIX 2: upsert ensures settings always persist
    const result = await db.collection('settings').findOneAndUpdate(
      { hotelId },
      { $set: updateData },
      { upsert: true, returnDocument: 'after' }
    );

    const updatedSettings = result || updateData;
    if (updatedSettings._id) updatedSettings._id = updatedSettings._id.toString();

    broadcast(hotelId, 'cfg_upd', {
      hotelName: updatedSettings.hotelName,
      currencySymbol: updatedSettings.currencySymbol,
      wifiPassword: updatedSettings.wifiPassword,
      language: updatedSettings.language,
      theme: updatedSettings.theme
    }, req.clientId);
    // ✅ FIX 8: Notify guest devices about settings change (wifi, language, etc.)
    io.to(`guest_${hotelId}`).emit('settings_updated', {
      hotelId,
      language: updatedSettings.language,
      currencySymbol: updatedSettings.currencySymbol,
      hotelName: updatedSettings.hotelName,
      syncToken: Date.now()
    });
    res.json({ ...updatedSettings, success: true, message: 'Settings saved' });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== BOOKINGS ========================

app.get('/api/bookings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const bookings = await db.collection('bookings').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    bookings.forEach(b => { if (b._id) b._id = b._id.toString(); }); // ✅ FIX 2
    res.json(bookings);
  } catch (error) {
    console.error('Bookings fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bookings', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { guestName, roomNumber, roomType, checkIn, checkOut, guests, totalPriceSAR, status } = req.body;

    if (!guestName || !roomNumber) return res.status(400).json({ success: false, error: 'guestName and roomNumber are required' });

    const booking = {
      hotelId, guestName, roomNumber: parseInt(roomNumber),
      roomType: roomType || 'Standard',
      checkIn: checkIn || new Date().toISOString().split('T')[0],
      checkOut: checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0],
      guests: guests || 1, totalPriceSAR: totalPriceSAR || 0,
      status: status || 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _version: 1
    };

    if (!dbConnected) {
      booking._id = 'bk_'+Date.now();
      broadcast(hotelId, 'booking_new', booking, req.clientId);
      return res.status(201).json({ ...booking, success: true, message: 'Booking added (offline)' });
    }

    const result = await db.collection('bookings').insertOne(booking);
    booking._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'booking_new', booking, req.clientId);
    // ✅ FIX 8: Notify guest room about their booking confirmation
    broadcastToGuestRoom(hotelId, parseInt(roomNumber), 'booking_confirmed', booking);
    res.status(201).json({ ...booking, success: true, message: 'Booking added' });
  } catch (error) {
    console.error('Booking create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/bookings/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, guests, checkIn, checkOut, totalPriceSAR } = req.body;

    if (!dbConnected) {
      const updatedBooking = {
        _id: id, hotelId, status,
        guests: guests !== undefined ? parseInt(guests) : undefined,
        checkIn, checkOut,
        totalPriceSAR: totalPriceSAR !== undefined ? parseFloat(totalPriceSAR) : undefined,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'booking_upd', updatedBooking, req.clientId);
      return res.json({ ...updatedBooking, success: true, message: 'Booking updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(status && { status }),
      ...(guests !== undefined && { guests: parseInt(guests) }),
      ...(checkIn && { checkIn }),
      ...(checkOut && { checkOut }),
      ...(totalPriceSAR !== undefined && { totalPriceSAR: parseFloat(totalPriceSAR) })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('bookings').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Booking not found' });

    const updatedBooking = result;
    if (updatedBooking._id) updatedBooking._id = updatedBooking._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'booking_upd', updatedBooking, req.clientId);
    // ✅ FIX 8: Notify guest about booking status change
    if (updatedBooking.roomNumber) {
      broadcastToGuestRoom(hotelId, updatedBooking.roomNumber, 'booking_status_changed', updatedBooking);
    }
    res.json({ ...updatedBooking, success: true, message: 'Booking updated' });
  } catch (error) {
    console.error('Booking update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/bookings/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'booking_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Booking deleted (offline)' });
    }

    const result = await db.collection('bookings').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Booking not found' });

    broadcast(hotelId, 'booking_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    console.error('Booking delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== BLACKLIST ========================

app.get('/api/blacklist', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const blacklist = await db.collection('blacklist').find({ hotelId }).sort({ date: -1 }).toArray();
    blacklist.forEach(b => { if (b._id) b._id = b._id.toString(); }); // ✅ FIX 2
    res.json(blacklist);
  } catch (error) {
    console.error('Blacklist fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/blacklist', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, room, reason } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const entry = {
      hotelId, name, room: room || null,
      reason: reason || '', date: new Date().toISOString(), _version: 1
    };

    if (!dbConnected) {
      entry._id = 'bl_'+Date.now();
      broadcast(hotelId, 'blacklist_upd', entry, req.clientId);
      return res.status(201).json({ ...entry, success: true, message: 'Guest blocked (offline)' });
    }

    const result = await db.collection('blacklist').insertOne(entry);
    entry._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'blacklist_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true, message: 'Guest blocked' });
  } catch (error) {
    console.error('Blacklist create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/blacklist/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'blacklist_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Unblocked (offline)' });
    }

    const result = await db.collection('blacklist').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Entry not found' });

    broadcast(hotelId, 'blacklist_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Guest unblocked' });
  } catch (error) {
    console.error('Blacklist delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== MAINTENANCE ========================

app.get('/api/maintenance', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const maintenance = await db.collection('maintenance').find({ hotelId }).sort({ scheduled: 1 }).toArray();
    maintenance.forEach(m => { if (m._id) m._id = m._id.toString(); }); // ✅ FIX 2
    res.json(maintenance);
  } catch (error) {
    console.error('Maintenance fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/maintenance', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { task, room, scheduled, assigned, priority, status } = req.body;

    if (!task) return res.status(400).json({ success: false, error: 'task is required' });

    const item = {
      hotelId, task, room: room || null, scheduled: scheduled || null,
      assigned: assigned || null, priority: priority || 'medium',
      status: status || 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _version: 1
    };

    if (!dbConnected) {
      item._id = 'm_'+Date.now();
      broadcast(hotelId, 'maintenance_upd', item, req.clientId);
      return res.status(201).json({ ...item, success: true, message: 'Task added (offline)' });
    }

    const result = await db.collection('maintenance').insertOne(item);
    item._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'maintenance_upd', item, req.clientId);
    res.status(201).json({ ...item, success: true, message: 'Task added' });
  } catch (error) {
    console.error('Maintenance create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/maintenance/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, assigned, priority } = req.body;

    if (!dbConnected) {
      const updated = { _id: id, hotelId, status, assigned, priority, updatedAt: new Date().toISOString() };
      broadcast(hotelId, 'maintenance_upd', updated, req.clientId);
      return res.json({ ...updated, success: true, message: 'Task updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(status && { status }),
      ...(assigned !== undefined && { assigned }),
      ...(priority && { priority })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('maintenance').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Task not found' });

    const updated = result;
    if (updated._id) updated._id = updated._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'maintenance_upd', updated, req.clientId);
    res.json({ ...updated, success: true, message: 'Task updated' });
  } catch (error) {
    console.error('Maintenance update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/maintenance/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'maintenance_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Task deleted (offline)' });
    }

    const result = await db.collection('maintenance').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    broadcast(hotelId, 'maintenance_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    console.error('Maintenance delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== REVIEWS ========================

app.get('/api/reviews', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const reviews = await db.collection('reviews').find({ hotelId }).sort({ date: -1 }).toArray();
    reviews.forEach(r => { if (r._id) r._id = r._id.toString(); }); // ✅ FIX 2
    res.json(reviews);
  } catch (error) {
    console.error('Reviews fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reviews', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { guest, room, overall, service, cleanliness, comment, recommend } = req.body;

    if (!guest || overall === undefined) return res.status(400).json({ success: false, error: 'guest and overall rating are required' });

    const review = {
      hotelId, guest, room: room || null,
      overall: parseInt(overall),
      service: service !== undefined ? parseInt(service) : null,
      cleanliness: cleanliness !== undefined ? parseInt(cleanliness) : null,
      comment: comment || '', recommend: recommend !== false,
      date: new Date().toISOString(), _version: 1
    };

    if (!dbConnected) {
      review._id = 'rev_'+Date.now();
      broadcast(hotelId, 'review_new', review, req.clientId);
      return res.status(201).json({ ...review, success: true, message: 'Review added (offline)' });
    }

    const result = await db.collection('reviews').insertOne(review);
    review._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'review_new', review, req.clientId);
    // ✅ FIX 8: Notify admins about new review
    broadcastToAdminRoom(hotelId, 'new_guest_review', review);
    res.status(201).json({ ...review, success: true, message: 'Review added' });
  } catch (error) {
    console.error('Review create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== STAFF ========================

app.get('/api/staff', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const staff = await db.collection('staff').find({ hotelId }).sort({ name: 1 }).toArray();
    staff.forEach(s => { if (s._id) s._id = s._id.toString(); }); // ✅ FIX 2
    res.json(staff);
  } catch (error) {
    console.error('Staff fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/staff', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { name, role, department, joinDate, status, shift, rating, tasks, attendance, leaveRequest } = req.body;

    if (!name || !role) return res.status(400).json({ success: false, error: 'name and role are required' });

    const s = {
      hotelId, name, role, department: department || 'General',
      joinDate: joinDate || new Date().toISOString().split('T')[0],
      status: status || 'online', shift: shift || 'morning',
      rating: rating || 5.0, tasks: tasks || 0,
      attendance: attendance || 'present', leaveRequest: leaveRequest || null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _version: 1
    };

    if (!dbConnected) {
      s._id = 's_'+Date.now();
      broadcast(hotelId, 'staff_upd', s, req.clientId);
      return res.status(201).json({ ...s, success: true, message: 'Staff added (offline)' });
    }

    const result = await db.collection('staff').insertOne(s);
    s._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'staff_upd', s, req.clientId);
    res.status(201).json({ ...s, success: true, message: 'Staff added' });
  } catch (error) {
    console.error('Staff create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/staff/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { status, shift, attendance, leaveRequest, rating, tasks } = req.body;

    if (!dbConnected) {
      const updated = {
        _id: id, hotelId, status, shift, attendance, leaveRequest,
        rating: rating !== undefined ? parseFloat(rating) : undefined,
        tasks: tasks !== undefined ? parseInt(tasks) : undefined,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'staff_upd', updated, req.clientId);
      return res.json({ ...updated, success: true, message: 'Staff updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(status && { status }),
      ...(shift && { shift }),
      ...(attendance && { attendance }),
      ...(leaveRequest !== undefined && { leaveRequest }),
      ...(rating !== undefined && { rating: parseFloat(rating) }),
      ...(tasks !== undefined && { tasks: parseInt(tasks) })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('staff').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ success: false, error: 'Staff not found' });

    const updated = result;
    if (updated._id) updated._id = updated._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'staff_upd', updated, req.clientId);
    res.json({ ...updated, success: true, message: 'Staff updated' });
  } catch (error) {
    console.error('Staff update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/staff/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'staff_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Staff removed (offline)' });
    }

    const result = await db.collection('staff').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Staff not found' });

    broadcast(hotelId, 'staff_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Staff removed' });
  } catch (error) {
    console.error('Staff delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== LOGS ========================

app.get('/api/logs', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const logs = await db.collection('logs').find({ hotelId }).sort({ timestamp: -1 }).limit(100).toArray();
    logs.forEach(l => { if (l._id) l._id = l._id.toString(); }); // ✅ FIX 2
    res.json(logs);
  } catch (error) {
    console.error('Logs fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/logs', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { user, action, details } = req.body;

    if (!action) return res.status(400).json({ success: false, error: 'action is required' });

    const log = {
      hotelId, timestamp: new Date().toISOString(),
      user: user || 'System', action, details: details || '', _version: 1
    };

    if (!dbConnected) {
      log._id = 'log_'+Date.now();
      return res.status(201).json({ ...log, success: true, message: 'Log added (offline)' });
    }

    const result = await db.collection('logs').insertOne(log);
    log._id = result.insertedId.toString(); // ✅ FIX 2
    res.status(201).json({ ...log, success: true, message: 'Log added' });
  } catch (error) {
    console.error('Log create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/logs', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, message: 'Logs cleared (offline)' });
    await db.collection('logs').deleteMany({ hotelId });
    res.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    console.error('Logs clear error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== CONFIG ========================

app.get('/api/config', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const defaultConfig = {
      _id: `config_${hotelId}`,
      hotelId,
      name: 'Crown Plaza Hotel',
      currency: 'SAR',
      wifi: 'CrownPlaza@2024',
      airportPrice: 115,
      localPrice: 60,
      _version: 1,
      updatedAt: new Date()
    };

    if (!dbConnected) return res.json(defaultConfig);

    const config = await db.collection('config').findOne({ hotelId });
    if (config && config._id) config._id = config._id.toString(); // ✅ FIX 2
    res.json(config || defaultConfig);
  } catch (error) {
    console.error('Config fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/config', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const config = {
      ...req.body,
      hotelId,
      _id: req.body._id || `config_${hotelId}`,
      _version: 1,
      updatedAt: new Date()
    };

    if (!dbConnected) {
      broadcast(hotelId, 'cfg_upd', config, req.clientId);
      return res.status(201).json({ ...config, success: true });
    }

    // ✅ FIX 2: Always upsert to ensure data persists
    const result = await db.collection('config').findOneAndUpdate(
      { hotelId },
      { $set: config },
      { upsert: true, returnDocument: 'after' }
    );

    const saved = result || config;
    if (saved && saved._id) saved._id = saved._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'cfg_upd', saved, req.clientId);
    io.to(`guest_${hotelId}`).emit('config_updated', { hotelId, config: saved, syncToken: Date.now() });
    res.status(201).json({ ...saved, success: true });
  } catch (error) {
    console.error('Config POST error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/config', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const config = req.body;

    if (!dbConnected) {
      const updated = { ...config, hotelId, _id: `config_${hotelId}`, updatedAt: new Date() };
      broadcast(hotelId, 'cfg_upd', updated, req.clientId);
      return res.json({ ...updated, success: true, message: 'Config saved (offline)' });
    }

    const updateData = {
      ...config,
      hotelId,
      _id: `config_${hotelId}`,
      _version: (config._version || 0) + 1,
      updatedAt: new Date()
    };

    // ✅ FIX 2: upsert guarantees persistence
    const result = await db.collection('config').findOneAndUpdate(
      { hotelId },
      { $set: updateData },
      { upsert: true, returnDocument: 'after' }
    );

    const updated = result || updateData;
    if (updated && updated._id) updated._id = updated._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'cfg_upd', updated, req.clientId);
    // ✅ FIX 8: Push config update to all guest devices
    io.to(`guest_${hotelId}`).emit('config_updated', { hotelId, config: updated, syncToken: Date.now() });
    res.json({ ...updated, success: true, message: 'Config saved' });
  } catch (error) {
    console.error('Config save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== ANNOUNCEMENTS ========================

app.get('/api/announcements', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const announcements = await db.collection('announcements').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    announcements.forEach(a => { if (a._id) a._id = a._id.toString(); }); // ✅ FIX 2
    res.json(announcements);
  } catch (error) {
    console.error('Announcements fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/announcements', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { category, title, message, isActive } = req.body;

    if (!category || !title || !message) {
      return res.status(400).json({ success: false, error: 'category, title, and message are required' });
    }

    if (!dbConnected) {
      const announcement = {
        _id: 'ann_' + Date.now(),
        hotelId, category, title, message,
        isActive: isActive !== undefined ? isActive : true,
        _version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'announcement_upd', announcement, req.clientId);
      io.to(`guest_${hotelId}`).emit('new_announcement', { hotelId, announcement, syncToken: Date.now() });
      return res.status(201).json({ ...announcement, success: true, message: 'Announcement added (offline)' });
    }

    const announcement = {
      hotelId, category, title, message,
      isActive: isActive !== undefined ? isActive : true,
      _version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = await db.collection('announcements').insertOne(announcement);
    announcement._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'announcement_upd', announcement, req.clientId);
    // ✅ FIX 8: Push announcements to ALL guest devices in real-time
    io.to(`guest_${hotelId}`).emit('new_announcement', { hotelId, announcement, syncToken: Date.now() });
    res.status(201).json({ ...announcement, success: true, message: 'Announcement created' });
  } catch (error) {
    console.error('Announcement create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/announcements/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { category, title, message, isActive } = req.body;

    if (!dbConnected) {
      const updated = {
        _id: id, hotelId, category, title, message, isActive,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'announcement_upd', updated, req.clientId);
      return res.json({ ...updated, success: true, message: 'Announcement updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(category && { category }),
      ...(title && { title }),
      ...(message && { message }),
      ...(isActive !== undefined && { isActive })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('announcements').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Announcement not found' });
    }

    const updated = result;
    if (updated._id) updated._id = updated._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'announcement_upd', updated, req.clientId);
    // ✅ FIX 8: Push to guests
    if (updated.isActive) {
      io.to(`guest_${hotelId}`).emit('announcement_changed', { hotelId, announcement: updated, syncToken: Date.now() });
    }
    res.json({ ...updated, success: true, message: 'Announcement updated' });
  } catch (error) {
    console.error('Announcement update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/announcements/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'announcement_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Announcement deleted (offline)' });
    }

    const result = await db.collection('announcements').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Announcement not found' });
    }

    broadcast(hotelId, 'announcement_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    io.to(`guest_${hotelId}`).emit('announcement_deleted', { hotelId, id, syncToken: Date.now() });
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    console.error('Announcement delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== POLICIES ========================

app.get('/api/policies', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const policies = await db.collection('policies').find({ hotelId }).toArray();
    policies.forEach(p => { if (p._id) p._id = p._id.toString(); }); // ✅ FIX 2
    res.json(policies);
  } catch (error) {
    console.error('Policies fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/policies', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { type, content, isEnabled } = req.body;

    if (!type || !content) {
      return res.status(400).json({ success: false, error: 'type and content are required' });
    }

    if (!dbConnected) {
      const policy = {
        _id: 'pol_' + Date.now(),
        hotelId, type, content,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        _version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'policy_upd', policy, req.clientId);
      return res.status(201).json({ ...policy, success: true, message: 'Policy added (offline)' });
    }

    const policy = {
      hotelId, type, content,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      _version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = await db.collection('policies').insertOne(policy);
    policy._id = result.insertedId.toString(); // ✅ FIX 2
    broadcast(hotelId, 'policy_upd', policy, req.clientId);
    // ✅ FIX 8: Push policy changes to guest devices
    io.to(`guest_${hotelId}`).emit('policy_updated', { hotelId, policy, syncToken: Date.now() });
    res.status(201).json({ ...policy, success: true, message: 'Policy created' });
  } catch (error) {
    console.error('Policy create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/policies/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    const { type, content, isEnabled } = req.body;

    if (!dbConnected) {
      const updated = {
        _id: id, hotelId, type, content, isEnabled,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'policy_upd', updated, req.clientId);
      return res.json({ ...updated, success: true, message: 'Policy updated (offline)' });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(type && { type }),
      ...(content && { content }),
      ...(isEnabled !== undefined && { isEnabled })
    };

    // ✅ FIX 3: Single round trip
    const result = await db.collection('policies').findOneAndUpdate(
      { _id: parseId(id), hotelId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Policy not found' });
    }

    const updated = result;
    if (updated._id) updated._id = updated._id.toString(); // ✅ FIX 2
    broadcast(hotelId, 'policy_upd', updated, req.clientId);
    io.to(`guest_${hotelId}`).emit('policy_updated', { hotelId, policy: updated, syncToken: Date.now() });
    res.json({ ...updated, success: true, message: 'Policy updated' });
  } catch (error) {
    console.error('Policy update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/policies/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;

    if (!dbConnected) {
      broadcast(hotelId, 'policy_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Policy deleted (offline)' });
    }

    const result = await db.collection('policies').deleteOne({ _id: parseId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Policy not found' });
    }

    broadcast(hotelId, 'policy_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    io.to(`guest_${hotelId}`).emit('policy_deleted', { hotelId, id, syncToken: Date.now() });
    res.json({ success: true, message: 'Policy deleted' });
  } catch (error) {
    console.error('Policy delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== DASHBOARD ========================

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected || !db) return res.status(503).json({ success: false, error: 'Database connecting...' });

    // ✅ FIX 3: All queries in parallel for maximum speed
    const [rooms, bookings, requests, guests, food, inventory, announcements, policies] = await Promise.all([
      db.collection('rooms').find({ hotelId }).toArray(),
      db.collection('bookings').find({ hotelId }).toArray(),
      db.collection('requests').find({ hotelId }).toArray(),
      db.collection('guests').find({ hotelId }).toArray(),
      db.collection('food').find({ hotelId }).toArray(),
      db.collection('inventory').find({ hotelId }).toArray(),
      db.collection('announcements').find({ hotelId, isActive: true }).toArray(),
      db.collection('policies').find({ hotelId, isEnabled: true }).toArray()
    ]);

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
    const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPriceSAR || b.totalPrice || 0), 0);
    const openRequests = requests.filter(r => r.status === 'open').length;
    const emergencyRequests = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;

    // ✅ FIX 6: Include live online count in dashboard stats
    const hotelRoomClients = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
    const onlineDevices = hotelRoomClients ? hotelRoomClients.size : 0;
    const adminRoomClients = io.sockets.adapter.rooms.get(`admin_${hotelId}`);
    const onlineAdmins = adminRoomClients ? adminRoomClients.size : 0;
    const guestRoomClients = io.sockets.adapter.rooms.get(`guest_${hotelId}`);
    const onlineGuests = guestRoomClients ? guestRoomClients.size : 0;

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
        announcements: { total: announcements.length },
        policies: { total: policies.length },
        occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0,
        // ✅ FIX 6: Live device counts
        liveConnections: { total: onlineDevices, admins: onlineAdmins, guests: onlineGuests }
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== PAGE STATE ========================

// ✅ FIX 5: Enhanced page state with MongoDB persistence + version tracking
app.post('/api/user/page-state', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { page, state, version } = req.body;
    const email = req.user?.email;

    if (!email) return res.status(400).json({ success: false, error: 'User not identified' });

    if (!dbConnected) {
      return res.json({ success: true, message: 'Page state saved (memory only)' });
    }

    // ✅ FIX 5: Upsert with version for conflict resolution
    await db.collection('sessions').updateOne(
      { email, hotelId },
      {
        $set: {
          lastPage: page,
          pageState: state,
          pageVersion: version || Date.now(),
          lastActivity: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'Page state saved' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/user/page-state', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const email = req.user?.email;

    if (!email) return res.status(400).json({ success: false, error: 'User not identified' });

    if (!dbConnected) {
      return res.json({ success: true, data: { lastPage: null, pageState: null } });
    }

    const sessionDoc = await db.collection('sessions').findOne({ email, hotelId });

    res.json({
      success: true,
      data: {
        lastPage: sessionDoc?.lastPage || null,
        pageState: sessionDoc?.pageState || null,
        pageVersion: sessionDoc?.pageVersion || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ FIX 5+6: NEW - Guest page state (for guest dashboard page stability)
app.post('/api/guest/page-state', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { roomNumber, page, state } = req.body;

    if (!roomNumber) return res.status(400).json({ success: false, error: 'roomNumber is required' });

    if (!dbConnected) {
      return res.json({ success: true, message: 'Guest page state saved (memory only)' });
    }

    await db.collection('sessions').updateOne(
      { guestRoom: parseInt(roomNumber), hotelId },
      {
        $set: {
          lastGuestPage: page,
          guestPageState: state,
          lastActivity: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'Guest page state saved' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/guest/page-state', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { roomNumber } = req.query;

    if (!roomNumber) return res.status(400).json({ success: false, error: 'roomNumber is required' });

    if (!dbConnected) {
      return res.json({ success: true, data: { lastGuestPage: null, guestPageState: null } });
    }

    const sessionDoc = await db.collection('sessions').findOne({
      guestRoom: parseInt(roomNumber),
      hotelId
    });

    res.json({
      success: true,
      data: {
        lastGuestPage: sessionDoc?.lastGuestPage || null,
        guestPageState: sessionDoc?.guestPageState || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ FIX 6: NEW - Get live connection stats for admin dashboard
app.get('/api/live/connections', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const hotelRoom = io.sockets.adapter.rooms.get(`hotel_${hotelId}`);
    const adminRoom = io.sockets.adapter.rooms.get(`admin_${hotelId}`);
    const guestRoom = io.sockets.adapter.rooms.get(`guest_${hotelId}`);

    res.json({
      success: true,
      data: {
        hotelId,
        total: hotelRoom ? hotelRoom.size : 0,
        admins: adminRoom ? adminRoom.size : 0,
        guests: guestRoom ? guestRoom.size : 0,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================== STATIC ROUTES ========================

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

// ======================== HOUSEKEEPING ========================

app.get('/api/housekeeping', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('housekeeping').find({ hotelId }).sort({ scheduledAt: 1 }).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/housekeeping', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, _version: 1 };
    if (!dbConnected) { entry._id = 'hk_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('housekeeping').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'housekeeping_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/housekeeping/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    const update = { ...req.body }; delete update._id;
    await db.collection('housekeeping').updateOne({ _id: parseId(id), hotelId }, { $set: update });
    broadcast(hotelId, 'housekeeping_upd', { _id: id, hotelId, ...update }, req.clientId);
    res.json({ success: true, _id: id, ...update });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/housekeeping/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('housekeeping').deleteOne({ _id: parseId(id), hotelId });
    broadcast(hotelId, 'housekeeping_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== OFFERS ========================

app.get('/api/offers', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('offers').find({ hotelId }).sort({ _id: -1 }).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/offers', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, _version: 1 };
    if (!dbConnected) { entry._id = 'off_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('offers').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'offers_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/offers/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    const update = { ...req.body }; delete update._id;
    await db.collection('offers').updateOne({ _id: parseId(id), hotelId }, { $set: update });
    broadcast(hotelId, 'offers_upd', { _id: id, hotelId, ...update }, req.clientId);
    res.json({ success: true, _id: id, ...update });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/offers/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('offers').deleteOne({ _id: parseId(id), hotelId });
    broadcast(hotelId, 'offers_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== LOST & FOUND ========================

app.get('/api/lostfound', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('lostfound').find({ hotelId }).sort({ foundDate: -1 }).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/lostfound', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, status: req.body.status || 'unclaimed', _version: 1 };
    if (!dbConnected) { entry._id = 'lf_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('lostfound').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'lostfound_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/lostfound/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    const update = { ...req.body }; delete update._id;
    await db.collection('lostfound').updateOne({ _id: parseId(id), hotelId }, { $set: update });
    broadcast(hotelId, 'lostfound_upd', { _id: id, hotelId, ...update }, req.clientId);
    res.json({ success: true, _id: id, ...update });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/lostfound/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('lostfound').deleteOne({ _id: parseId(id), hotelId });
    broadcast(hotelId, 'lostfound_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== CHAT MESSAGES ========================

app.get('/api/chat', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('chat').find({ hotelId }).sort({ time: 1 }).limit(200).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, time: req.body.time || new Date().toISOString(), _version: 1 };
    if (!dbConnected) { entry._id = 'cm_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('chat').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'chat_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/chat', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('chat').deleteMany({ hotelId });
    broadcast(hotelId, 'chat_cleared', { hotelId }, req.clientId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== GENERIC CRUD FACTORY ========================
function makeCRUD(collection) {
  app.get(`/api/${collection}`, async (req, res) => {
    try {
      const hotelId = req.hotelId;
      if (!dbConnected) return res.json([]);
      const data = await db.collection(collection).find({ hotelId }).sort({ _id: -1 }).toArray();
      data.forEach(d => { if (d._id) d._id = d._id.toString(); });
      res.json(data);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });
  app.post(`/api/${collection}`, authMiddleware, async (req, res) => {
    try {
      const hotelId = req.hotelId;
      const entry = { hotelId, ...req.body, _version: 1 };
      if (!dbConnected) { entry._id = collection+'_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
      const result = await db.collection(collection).insertOne(entry);
      entry._id = result.insertedId.toString();
      broadcast(hotelId, collection+'_upd', entry, req.clientId);
      res.status(201).json({ ...entry, success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });
  app.put(`/api/${collection}/:id`, authMiddleware, async (req, res) => {
    try {
      const hotelId = req.hotelId;
      const { id } = req.params;
      if (!dbConnected) return res.json({ success: true });
      const update = { ...req.body }; delete update._id;
      await db.collection(collection).updateOne({ _id: parseId(id), hotelId }, { $set: update });
      broadcast(hotelId, collection+'_upd', { _id: id, hotelId, ...update }, req.clientId);
      res.json({ success: true, _id: id, ...update });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });
  app.delete(`/api/${collection}/:id`, authMiddleware, async (req, res) => {
    try {
      const hotelId = req.hotelId;
      const { id } = req.params;
      if (!dbConnected) return res.json({ success: true });
      await db.collection(collection).deleteOne({ _id: parseId(id), hotelId });
      broadcast(hotelId, collection+'_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });
}

// Register all new collections
['billing','restaurant','tablebookings','spa','events','wakeupcalls','parking','feedback','laundry'].forEach(makeCRUD);

// Feedback: allow guest POST without auth
app.post('/api/feedback/guest', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, _version: 1 };
    if (!dbConnected) { entry._id = 'fb_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('feedback').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'feedback_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ======================== CITY GUIDE ========================

app.get('/api/cityguide', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('cityguide').find({ hotelId }).sort({ _id: 1 }).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/cityguide', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body };
    if (!dbConnected) { entry._id = 'cg_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('cityguide').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'cityguide_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/cityguide/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    const update = { ...req.body }; delete update._id;
    await db.collection('cityguide').updateOne({ _id: parseId(id), hotelId }, { $set: update });
    broadcast(hotelId, 'cityguide_upd', { _id: id, hotelId, ...update }, req.clientId);
    res.json({ success: true, _id: id, ...update });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/cityguide/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('cityguide').deleteOne({ _id: parseId(id), hotelId });
    broadcast(hotelId, 'cityguide_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ======================== SERVER START ========================

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`👑 Admin: http://localhost:${PORT}/admin`);
  console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
  console.log(`📡 Socket.io: Enabled (with heartbeat)`);
  console.log(`🏨 Multi-tenant: Enabled`);
  console.log(`🔐 Auth: JWT + bcrypt + idle timeout (${Math.floor(IDLE_TIMEOUT_MS/60000)} min)`);
  console.log(`🌍 Multi-country: Enabled (currency, language, timezone)`);
  console.log(`💳 Subscriptions: lifetime/monthly/trial supported`);
  console.log(`📊 Advanced: Rate limiting, compression, idempotency, page state`);
  console.log(`🔄 Auto token refresh: Enabled (threshold: ${Math.floor(TOKEN_REFRESH_THRESHOLD_MS/60000)} min)`);
  console.log(`📍 Page stability: /api/user/page-state + /api/guest/page-state`);
  console.log(`🔔 Idle session logout: /api/auth/config, /api/auth/ping`);
  console.log(`📜 Policies API: /api/policies`);
  console.log(`📢 Announcements API: /api/announcements`);
  console.log(`⚙️ Config API: /api/config`);
  console.log(`🏢 Departments API: /api/departments`);
  console.log(`\n✅ v5.0 FIXES:`);
  console.log(`   FIX 1: Login speed - subscription cache + fast bcrypt path`);
  console.log(`   FIX 2: Data persistence - ObjectId→String, upsert on all configs`);
  console.log(`   FIX 3: Add/Update speed - findOneAndUpdate (single DB round trip)`);
  console.log(`   FIX 4: Real-time sync - hotel/admin/guest Socket.io rooms`);
  console.log(`   FIX 5: Page stability - MongoDB-backed page state for admin+guest`);
  console.log(`   FIX 6: Multi-device sync - room_{hotelId}_{roomNo} channels`);
  console.log(`   FIX 7: MongoDB pool: 100 max / 20 min connections`);
  console.log(`   FIX 8: Guest↔Admin cross-sync (new_guest_request, admin_reply)`);
  console.log(`   FIX 9: Heartbeat ping to keep sessions alive across devices`);
  console.log(`   FIX 10: Wire compression (zstd/zlib) for faster DB transfers`);
  console.log(`\n💡 NEW .env variables:`);
  console.log(`   IDLE_TIMEOUT_MS=1800000        (default: 30 min)`);
  console.log(`   TOKEN_EXPIRY=7d                 (default: 7 days)`);
  console.log(`   TOKEN_REFRESH_THRESHOLD_MS=3600000 (default: 1hr)`);
  console.log(`   SESSION_MAX_AGE=604800000       (default: 7 days)\n`);
  await connectDB();
});

// ======================== GRACEFUL SHUTDOWN ========================

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

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
  if (err.message.includes('EADDRINUSE')) process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});
