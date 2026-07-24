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

// ================= GUEST HUB MODULE ROUTES =================

// Static files serve karna (HTML, CSS, JS, Images)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 1. Guest Hub Routes
const guestHubRoutes = require('./api/guest-hub');
app.use('/api/guest-hub', guestHubRoutes);

// 2. Payment Routes
const paymentRoutes = require('./api/payment');
app.use('/api/payment', paymentRoutes);

// 3. AI Chat Routes
const aiChatRoutes = require('./api/ai-chat');
app.use('/api/ai-chat', aiChatRoutes);

// 4. Support Tickets Routes
const ticketRoutes = require('./api/tickets');
app.use('/api/tickets', ticketRoutes);

// ================= DEFAULT ROUTE =================
app.get('/', (req, res) => {
    res.send('🚀 Hotel Management Guest Hub API is running successfully!');
});

// ================= 404 ERROR HANDLER =================
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'API Endpoint not found' });
});

// ================= SERVER START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
    console.log(`✅ Guest Hub Module Loaded Successfully!`);
    console.log(`✅ Socket.io initialized for real-time sync`);
});

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
      { hotelId, role: { $in: ['hotel_admin', 'admin'] } },
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
// CREATE NEW HOTEL (Super Admin — Add Hotel Modal)
// ============================================
app.post('/api/super/create-hotel', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { hotelId, hotelName, adminEmail, password, subscriptionType, currency, address, phone } = req.body;
    if (!hotelId || !hotelName || !adminEmail || !password) {
      return res.status(400).json({ success: false, error: 'hotelId, hotelName, adminEmail, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    const existingTenant = await db.collection('tenants').findOne({ hotelId });
    if (existingTenant) {
      return res.status(400).json({ success: false, error: `Hotel with ID "${hotelId}" already exists` });
    }
    const hotel = {
      hotelId,
      hotelName,
      email: adminEmail,
      phone: phone || '',
      address: address || '',
      currency: currency || 'USD',
      subscriptionType: subscriptionType || 'basic',
      subscriptionExpiry: new Date(Date.now() + 30 * 86400000),
      active: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('tenants').insertOne(hotel);
    hotel._id = result.insertedId;
    const hashedPassword = await bcrypt.hash(password, 10);
    const adminUser = {
      hotelId,
      email: adminEmail,
      password: hashedPassword,
      name: `${hotelName} Administrator`,
      role: 'hotel_admin',
      permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
      active: true,
      createdAt: new Date()
    };
    await db.collection('users').insertOne(adminUser);
    await db.collection('settings').insertOne({
      hotelId,
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
    res.status(201).json({ success: true, data: hotel, message: 'Hotel created successfully' });
  } catch (err) {
    console.error('Create hotel error:', err);
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

// ✅ RATE PLANS — dynamic pricing rules per hotel (MongoDB backed)
app.get('/api/super/rate-plans', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [], stats: { active: 0, avgRate: 0, highestRate: 0 } });
    const plans = await db.collection('ratePlans').find({}).sort({ createdAt: -1 }).toArray();

    // Attach hotel name for display
    const hotelIds = [...new Set(plans.map(p => p.hotelId).filter(id => id && id !== 'ALL'))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = plans.map(p => ({
      id: p._id.toString(),
      name: p.name,
      hotelId: p.hotelId,
      hotelName: p.hotelId === 'ALL' ? 'All Hotels' : (hotelsMap[p.hotelId] || p.hotelId),
      baseRate: p.baseRate,
      season: p.season,
      minStay: p.minStay,
      status: p.status,
      createdAt: p.createdAt
    }));

    const activePlans = formatted.filter(p => p.status === 'active');
    const stats = {
      active: activePlans.length,
      avgRate: activePlans.length ? Math.round(activePlans.reduce((s, p) => s + Number(p.baseRate || 0), 0) / activePlans.length) : 0,
      highestRate: formatted.length ? Math.max(...formatted.map(p => Number(p.baseRate || 0))) : 0
    };

    res.json({ success: true, data: formatted, stats });
  } catch (err) {
    console.error('Get rate plans error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/rate-plans', superAdminMiddleware, async (req, res) => {
  try {
    const { name, hotelId, baseRate, season, minStay, status } = req.body;
    if (!name || !hotelId || baseRate === undefined || baseRate === null) {
      return res.status(400).json({ success: false, error: 'name, hotelId and baseRate are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const doc = {
      name: String(name).trim(),
      hotelId: String(hotelId).trim(),
      baseRate: Number(baseRate),
      season: season ? String(season).trim() : 'All Year',
      minStay: minStay ? Number(minStay) : 1,
      status: status === 'draft' ? 'draft' : 'active',
      createdAt: new Date()
    };
    const result = await db.collection('ratePlans').insertOne(doc);
    doc._id = result.insertedId;
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('Create rate plan error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/super/rate-plans/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { name, hotelId, baseRate, season, minStay, status } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (hotelId !== undefined) updateData.hotelId = String(hotelId).trim();
    if (baseRate !== undefined) updateData.baseRate = Number(baseRate);
    if (season !== undefined) updateData.season = String(season).trim();
    if (minStay !== undefined) updateData.minStay = Number(minStay);
    if (status !== undefined) updateData.status = status === 'draft' ? 'draft' : 'active';
    updateData.updatedAt = new Date();

    const result = await db.collection('ratePlans').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Rate plan not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update rate plan error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/super/rate-plans/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('ratePlans').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Rate plan not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete rate plan error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ LOYALTY PROGRAM — cross-hotel stats + rewards catalog (MongoDB backed)
app.get('/api/super/loyalty/stats', superAdminMiddleware, async (req, res) => {
  try {
    const tiers = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
    if (!dbConnected) {
      const byTier = {}; tiers.forEach(t => byTier[t] = 0);
      return res.json({ success: true, data: { totalMembers: 0, totalPointsIssued: 0, totalPointsRedeemed: 0, avgPointsPerMember: 0, byTier } });
    }
    const agg = await db.collection('loyalty').aggregate([
      { $group: { _id: null, totalMembers: { $sum: 1 }, totalPointsIssued: { $sum: '$totalEarned' }, totalPointsRedeemed: { $sum: '$totalRedeemed' } } }
    ]).toArray();
    const byTierAgg = await db.collection('loyalty').aggregate([
      { $group: { _id: '$tier', count: { $sum: 1 } } }
    ]).toArray();
    const byTier = {};
    tiers.forEach(t => byTier[t] = 0);
    byTierAgg.forEach(t => { if (t._id && byTier.hasOwnProperty(t._id)) byTier[t._id] = t.count; });
    const result = agg[0] || { totalMembers: 0, totalPointsIssued: 0, totalPointsRedeemed: 0 };
    const avgPointsPerMember = result.totalMembers ? Math.round(result.totalPointsIssued / result.totalMembers) : 0;
    res.json({
      success: true,
      data: {
        totalMembers: result.totalMembers,
        totalPointsIssued: result.totalPointsIssued,
        totalPointsRedeemed: result.totalPointsRedeemed,
        avgPointsPerMember,
        byTier
      }
    });
  } catch (err) {
    console.error('Get loyalty stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/loyalty-rewards', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const rewards = await db.collection('loyaltyRewards').find({}).sort({ createdAt: -1 }).toArray();
    const formatted = rewards.map(r => ({
      id: r._id.toString(),
      name: r.name,
      pointsCost: r.pointsCost,
      status: r.status,
      description: r.description || ''
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get loyalty rewards error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/loyalty-rewards', superAdminMiddleware, async (req, res) => {
  try {
    const { name, pointsCost, status, description } = req.body;
    if (!name || pointsCost === undefined || pointsCost === null) {
      return res.status(400).json({ success: false, error: 'name and pointsCost are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      name: String(name).trim(),
      pointsCost: Number(pointsCost),
      status: ['active', 'limited', 'inactive'].includes(status) ? status : 'active',
      description: description ? String(description).trim() : '',
      createdAt: new Date()
    };
    const result = await db.collection('loyaltyRewards').insertOne(doc);
    doc._id = result.insertedId;
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('Create loyalty reward error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/super/loyalty-rewards/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { name, pointsCost, status, description } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (pointsCost !== undefined) updateData.pointsCost = Number(pointsCost);
    if (status !== undefined) updateData.status = ['active', 'limited', 'inactive'].includes(status) ? status : 'active';
    if (description !== undefined) updateData.description = String(description).trim();
    updateData.updatedAt = new Date();
    const result = await db.collection('loyaltyRewards').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Reward not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update loyalty reward error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/super/loyalty-rewards/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('loyaltyRewards').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Reward not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete loyalty reward error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ FEATURE FLAGS — global / per-hotel / experiment toggles (MongoDB backed)
app.get('/api/super/feature-flags', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [], stats: { activeFlags: 0, hotelSpecific: 0, experiments: 0 } });
    const flags = await db.collection('featureFlags').find({}).sort({ createdAt: -1 }).toArray();
    const totalHotels = await db.collection('tenants').countDocuments({});

    const formatted = flags.map(f => {
      let hotelsLabel;
      if (f.scope === 'global') hotelsLabel = `All (${totalHotels})`;
      else if (f.scope === 'perHotel') hotelsLabel = `${(f.hotelIds || []).length} hotel${(f.hotelIds || []).length === 1 ? '' : 's'}`;
      else hotelsLabel = `${(f.hotelIds || []).length || 0} hotels`;
      return {
        id: f._id.toString(),
        name: f.name,
        scope: f.scope,
        hotelIds: f.hotelIds || [],
        hotelsLabel,
        enabled: !!f.enabled
      };
    });

    const stats = {
      activeFlags: formatted.filter(f => f.scope === 'global' && f.enabled).length,
      hotelSpecific: formatted.filter(f => f.scope === 'perHotel').length,
      experiments: formatted.filter(f => f.scope === 'experiment').length
    };

    res.json({ success: true, data: formatted, stats });
  } catch (err) {
    console.error('Get feature flags error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/feature-flags', superAdminMiddleware, async (req, res) => {
  try {
    const { name, scope, hotelIds, enabled } = req.body;
    if (!name || !scope) return res.status(400).json({ success: false, error: 'name and scope are required' });
    if (!['global', 'perHotel', 'experiment'].includes(scope)) {
      return res.status(400).json({ success: false, error: 'scope must be global, perHotel, or experiment' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      name: String(name).trim(),
      scope,
      hotelIds: scope === 'global' ? [] : (Array.isArray(hotelIds) ? hotelIds : []),
      enabled: !!enabled,
      createdAt: new Date()
    };
    const result = await db.collection('featureFlags').insertOne(doc);
    doc._id = result.insertedId;
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('Create feature flag error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/feature-flags/:id/toggle', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const flag = await db.collection('featureFlags').findOne({ _id: new ObjectId(id) });
    if (!flag) return res.status(404).json({ success: false, error: 'Flag not found' });
    await db.collection('featureFlags').updateOne({ _id: new ObjectId(id) }, { $set: { enabled: !flag.enabled } });
    res.json({ success: true, enabled: !flag.enabled });
  } catch (err) {
    console.error('Toggle feature flag error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/super/feature-flags/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('featureFlags').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Flag not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete feature flag error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ REVIEWS & RATINGS — cross-hotel guest feedback (MongoDB backed)
app.get('/api/super/reviews/stats', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: { avgRating: 0, totalReviews: 0, recommendRate: 0, pendingCount: 0 } });
    const reviews = await db.collection('reviews').find({ isDeleted: { $ne: true } }).toArray();
    const total = reviews.length;
    const avgRating = total > 0 ? (reviews.reduce((sum, r) => sum + (r.overall || 0), 0) / total).toFixed(1) : 0;
    const recommendCount = reviews.filter(r => r.recommend !== false).length;
    const recommendRate = total > 0 ? Math.round((recommendCount / total) * 100) : 0;
    const pendingCount = reviews.filter(r => r.status === 'pending').length;

    res.json({ success: true, data: { avgRating: Number(avgRating), totalReviews: total, recommendRate, pendingCount } });
  } catch (err) {
    console.error('Get review stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/reviews', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const reviews = await db.collection('reviews')
      .find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const hotelIds = [...new Set(reviews.map(r => r.hotelId).filter(Boolean))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = reviews.map(r => ({
      id: r._id.toString(),
      hotelId: r.hotelId,
      hotelName: hotelsMap[r.hotelId] || r.hotelId || 'Unknown',
      overall: r.overall || 0,
      comment: r.comment || '',
      status: r.status || 'pending',
      recommend: r.recommend !== false,
      createdAt: r.createdAt
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get reviews error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/super/reviews/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('reviews').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ HOUSEKEEPING — cross-hotel room status overview (MongoDB backed)
app.get('/api/super/housekeeping/stats', superAdminMiddleware, async (req, res) => {
  try {
    const statuses = ['Vacant', 'Occupied', 'Cleaning', 'Maintenance', 'Reserved'];
    if (!dbConnected) {
      const byStatus = {}; statuses.forEach(s => byStatus[s] = 0);
      return res.json({ success: true, data: byStatus });
    }
    const agg = await db.collection('rooms').aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    const byStatus = {};
    statuses.forEach(s => byStatus[s] = 0);
    agg.forEach(a => { if (a._id && byStatus.hasOwnProperty(a._id)) byStatus[a._id] = a.count; });
    res.json({ success: true, data: byStatus });
  } catch (err) {
    console.error('Get housekeeping stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/housekeeping/rooms', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const rooms = await db.collection('rooms')
      .find({ isDeleted: { $ne: true } })
      .sort({ hotelId: 1, number: 1 })
      .limit(200)
      .toArray();

    const hotelIds = [...new Set(rooms.map(r => r.hotelId).filter(Boolean))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = rooms.map(r => ({
      id: r._id.toString(),
      hotelId: r.hotelId,
      hotelName: hotelsMap[r.hotelId] || r.hotelId || 'Unknown',
      number: r.number,
      status: r.status || 'Vacant'
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get housekeeping rooms error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ STAFF MANAGEMENT — cross-hotel staff directory (MongoDB backed)
app.get('/api/super/staff/stats', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: { totalStaff: 0, onDuty: 0, onLeave: 0, departments: 0 } });
    const staff = await db.collection('staff').find({ isDeleted: { $ne: true } }).toArray();
    const totalStaff = staff.length;
    const onDuty = staff.filter(s => s.status === 'online' || s.status === 'on-duty').length;
    const onLeave = staff.filter(s => s.status === 'on-leave').length;
    const departments = new Set(staff.map(s => s.department || 'General')).size;
    res.json({ success: true, data: { totalStaff, onDuty, onLeave, departments } });
  } catch (err) {
    console.error('Get staff stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/staff', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const staff = await db.collection('staff')
      .find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const hotelIds = [...new Set(staff.map(s => s.hotelId).filter(Boolean))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = staff.map(s => ({
      id: s._id.toString(),
      name: s.name,
      role: s.role,
      department: s.department || 'General',
      hotelId: s.hotelId,
      hotelName: hotelsMap[s.hotelId] || s.hotelId || 'Unknown',
      status: s.status || 'offline',
      shift: s.shift || 'morning'
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get staff error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/staff', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId, name, role, department, status, shift } = req.body;
    if (!hotelId || !name || !role) {
      return res.status(400).json({ success: false, error: 'hotelId, name and role are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const validStatuses = ['online', 'offline', 'on-duty', 'on-leave', 'inactive'];
    const validShifts = ['morning', 'evening', 'night'];
    const doc = {
      hotelId: String(hotelId).trim(),
      name: String(name).trim(),
      role: String(role).trim(),
      department: department ? String(department).trim() : 'General',
      status: validStatuses.includes(status) ? status : 'online',
      shift: validShifts.includes(shift) ? shift : 'morning',
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('staff').insertOne(doc);
    doc._id = result.insertedId;
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('Create staff error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/super/staff/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Staff not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete staff error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ CHANNEL MANAGER — real OTA connection tracking per hotel (MongoDB backed)
const OTA_CHANNELS = ['Booking.com', 'Expedia', 'Airbnb', 'Agoda'];

app.get('/api/super/channels/stats', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) {
      return res.json({ success: true, data: OTA_CHANNELS.map(c => ({ channel: c, connectedCount: 0, lastSyncAt: null, lastStatus: null })) });
    }
    const connections = await db.collection('channelConnections').find({ status: 'connected' }).toArray();
    const logs = await db.collection('channelSyncLogs').find({}).sort({ createdAt: -1 }).toArray();

    const data = OTA_CHANNELS.map(channel => {
      const connectedCount = connections.filter(c => c.channel === channel).length;
      const lastLog = logs.find(l => l.channel === channel);
      return {
        channel,
        connectedCount,
        lastSyncAt: lastLog ? lastLog.createdAt : null,
        lastStatus: lastLog ? lastLog.status : null
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get channel stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/channels/logs', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const logs = await db.collection('channelSyncLogs').find({}).sort({ createdAt: -1 }).limit(20).toArray();

    const hotelIds = [...new Set(logs.map(l => l.hotelId).filter(Boolean))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = logs.map(l => ({
      id: l._id.toString(),
      channel: l.channel,
      hotelName: hotelsMap[l.hotelId] || l.hotelId || 'Unknown',
      action: l.action,
      status: l.status,
      createdAt: l.createdAt
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get channel logs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/channels/connect', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId, channel } = req.body;
    if (!hotelId || !channel || !OTA_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, error: 'Valid hotelId and channel are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const existing = await db.collection('channelConnections').findOne({ hotelId, channel });
    if (existing && existing.status === 'connected') {
      return res.status(400).json({ success: false, error: 'Hotel is already connected to this channel' });
    }

    if (existing) {
      await db.collection('channelConnections').updateOne({ _id: existing._id }, { $set: { status: 'connected', connectedAt: new Date() } });
    } else {
      await db.collection('channelConnections').insertOne({ hotelId, channel, status: 'connected', connectedAt: new Date() });
    }

    await db.collection('channelSyncLogs').insertOne({
      hotelId, channel, action: 'Channel connected', status: 'success', createdAt: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Connect channel error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/super/channels/disconnect', superAdminMiddleware, async (req, res) => {
  try {
    const { hotelId, channel } = req.body;
    if (!hotelId || !channel) return res.status(400).json({ success: false, error: 'hotelId and channel are required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const result = await db.collection('channelConnections').updateOne(
      { hotelId, channel },
      { $set: { status: 'disconnected', disconnectedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Connection not found' });

    await db.collection('channelSyncLogs').insertOne({
      hotelId, channel, action: 'Channel disconnected', status: 'success', createdAt: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Disconnect channel error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/channels/connections', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const connections = await db.collection('channelConnections').find({ status: 'connected' }).sort({ connectedAt: -1 }).toArray();

    const hotelIds = [...new Set(connections.map(c => c.hotelId).filter(Boolean))];
    const hotelsMap = {};
    if (hotelIds.length) {
      const hotelDocs = await db.collection('tenants').find({ hotelId: { $in: hotelIds } }).toArray();
      hotelDocs.forEach(h => { hotelsMap[h.hotelId] = h.hotelName || h.name || h.hotelId; });
    }

    const formatted = connections.map(c => ({
      hotelId: c.hotelId,
      hotelName: hotelsMap[c.hotelId] || c.hotelId || 'Unknown',
      channel: c.channel,
      connectedAt: c.connectedAt
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get channel connections error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ MULTI-TENANT — regional grouping of hotels/tenants (MongoDB backed)
const PLAN_PRICES = { basic: 0, pro: 99, enterprise: 499 };

app.get('/api/super/multi-tenant/stats', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: { totalTenants: 0, activeClusters: 0, avgGuestsPerTenant: 0, clusterNames: [] } });
    const tenants = await db.collection('tenants').find({}).toArray();
    const totalTenants = tenants.length;
    const regions = [...new Set(tenants.map(t => t.region).filter(Boolean))];

    const guestCounts = await Promise.all(tenants.map(t => db.collection('guests').countDocuments({ hotelId: t.hotelId })));
    const totalGuests = guestCounts.reduce((sum, c) => sum + c, 0);
    const avgGuestsPerTenant = totalTenants > 0 ? Math.round(totalGuests / totalTenants) : 0;

    res.json({
      success: true,
      data: { totalTenants, activeClusters: regions.length, avgGuestsPerTenant, clusterNames: regions }
    });
  } catch (err) {
    console.error('Get multi-tenant stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/super/multi-tenant/list', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const tenants = await db.collection('tenants').find({}).sort({ createdAt: -1 }).toArray();

    const formatted = await Promise.all(tenants.map(async (t) => {
      const [guests, rooms] = await Promise.all([
        db.collection('guests').countDocuments({ hotelId: t.hotelId }),
        db.collection('rooms').countDocuments({ hotelId: t.hotelId })
      ]);
      const plan = (t.subscriptionType || 'basic').toLowerCase();
      const monthlyRevenue = PLAN_PRICES.hasOwnProperty(plan) ? PLAN_PRICES[plan] : 0;
      return {
        hotelId: t.hotelId,
        hotelName: t.hotelName || t.hotelId,
        region: t.region || 'Unassigned',
        rooms,
        guests,
        monthlyRevenue,
        status: t.active !== false ? 'active' : 'inactive'
      };
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get multi-tenant list error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ GUEST CRM — marketing contact list, segments, CSV export (MongoDB backed)
const crypto = require('crypto');
const guestCRMExportTokens = new Map(); // token -> { csv, expiresAt }

function toCSV(rows) {
  const escape = (val) => {
    const s = String(val === undefined || val === null ? '' : val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = ['Name', 'Email', 'Phone', 'Segment', 'Status', 'Total Spent'];
  const lines = [header.join(',')];
  rows.forEach(g => {
    lines.push([g.name, g.email || '', g.phone || '', g.segment || '', g.status || 'active', g.totalSpent || 0].map(escape).join(','));
  });
  return lines.join('\n');
}

app.get('/api/guest-crm/guests', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const guests = await db.collection('guestCRM').find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).toArray();
    const formatted = guests.map(g => ({ _id: g._id.toString(), name: g.name, email: g.email, phone: g.phone, segment: g.segment, status: g.status, totalSpent: g.totalSpent }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get CRM guests error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/guest-crm/guests/:id', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const guest = await db.collection('guestCRM').findOne({ _id: new ObjectId(req.params.id) });
    if (!guest) return res.status(404).json({ success: false, error: 'Guest not found' });
    res.json({ success: true, data: { _id: guest._id.toString(), name: guest.name, email: guest.email, phone: guest.phone, segment: guest.segment, status: guest.status, totalSpent: guest.totalSpent } });
  } catch (err) {
    console.error('Get CRM guest error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/guest-crm/guests', superAdminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, segment, status, totalSpent } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      name: String(name).trim(),
      email: email ? String(email).trim() : '',
      phone: phone ? String(phone).trim() : '',
      segment: segment ? String(segment).trim() : '',
      status: status || 'active',
      totalSpent: parseFloat(totalSpent) || 0,
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('guestCRM').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), ...doc } });
  } catch (err) {
    console.error('Create CRM guest error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/guest-crm/guests/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { name, email, phone, segment, status, totalSpent } = req.body;
    const updateData = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = String(name).trim();
    if (email !== undefined) updateData.email = String(email).trim();
    if (phone !== undefined) updateData.phone = String(phone).trim();
    if (segment !== undefined) updateData.segment = String(segment).trim();
    if (status !== undefined) updateData.status = status;
    if (totalSpent !== undefined) updateData.totalSpent = parseFloat(totalSpent) || 0;
    const result = await db.collection('guestCRM').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Guest not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update CRM guest error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/guest-crm/guests/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('guestCRM').updateOne({ _id: new ObjectId(id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Guest not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete CRM guest error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/guest-crm/segments', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const segments = await db.collection('guestCRMSegments').find({}).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: segments.map(s => ({ _id: s._id.toString(), name: s.name })) });
  } catch (err) {
    console.error('Get CRM segments error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/guest-crm/segments', superAdminMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'Segment name is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = { name: String(name).trim(), createdAt: new Date() };
    const result = await db.collection('guestCRMSegments').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), name: doc.name } });
  } catch (err) {
    console.error('Create CRM segment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Honest: no email service (SMTP/SendGrid) is configured in this environment.
app.post('/api/guest-crm/guests/:id/email', superAdminMiddleware, async (req, res) => {
  res.status(503).json({ success: false, error: 'Email service not configured. Connect an SMTP/SendGrid provider to enable this feature.' });
});

app.get('/api/guest-crm/export', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const guests = await db.collection('guestCRM').find({ isDeleted: { $ne: true } }).toArray();
    const csv = toCSV(guests);
    const token = crypto.randomBytes(24).toString('hex');
    guestCRMExportTokens.set(token, { csv, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ success: true, url: `/api/guest-crm/export/${token}` });
  } catch (err) {
    console.error('Export CRM guests error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Public download route (short-lived random token acts as the access control, since a
// plain window.open() navigation cannot send an Authorization header).
app.get('/api/guest-crm/export/:token', (req, res) => {
  const entry = guestCRMExportTokens.get(req.params.token);
  if (!entry || entry.expiresAt < Date.now()) {
    guestCRMExportTokens.delete(req.params.token);
    return res.status(404).send('Export link expired or invalid. Please export again.');
  }
  guestCRMExportTokens.delete(req.params.token);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="guests_export.csv"');
  res.send(entry.csv);
});

// ✅ POS SYSTEM — items catalog, cart checkout, transaction history (MongoDB backed)
app.get('/api/pos/items', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const items = await db.collection('posItems').find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: items.map(i => ({ _id: i._id.toString(), name: i.name, price: i.price, category: i.category, emoji: i.emoji })) });
  } catch (err) {
    console.error('Get POS items error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/pos/categories', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const items = await db.collection('posItems').find({ isDeleted: { $ne: true } }).toArray();
    const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
    res.json({ success: true, data: categories.map(c => ({ _id: c, name: c })) });
  } catch (err) {
    console.error('Get POS categories error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pos/items', superAdminMiddleware, async (req, res) => {
  try {
    const { name, price, category, emoji } = req.body;
    if (!name || price === undefined || price === null) {
      return res.status(400).json({ success: false, error: 'name and price are required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      name: String(name).trim(),
      price: Number(price),
      category: category ? String(category).trim() : 'Uncategorized',
      emoji: emoji || '📦',
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('posItems').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), ...doc } });
  } catch (err) {
    console.error('Create POS item error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/pos/items/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { name, price, category, emoji } = req.body;
    const updateData = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = String(name).trim();
    if (price !== undefined) updateData.price = Number(price);
    if (category !== undefined) updateData.category = String(category).trim();
    if (emoji !== undefined) updateData.emoji = emoji;
    const result = await db.collection('posItems').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update POS item error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/pos/items/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('posItems').updateOne({ _id: new ObjectId(id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete POS item error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/pos/transactions', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const transactions = await db.collection('posTransactions').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    const formatted = transactions.map(t => {
      const count = Array.isArray(t.items) ? t.items.reduce((sum, i) => sum + (i.quantity || 1), 0) : 0;
      return {
        transactionId: t.transactionId,
        items: `${count} item${count === 1 ? '' : 's'}`,
        total: t.total,
        paymentMethod: t.paymentMethod || 'Cash',
        status: t.status || 'completed',
        createdAt: t.createdAt
      };
    });
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get POS transactions error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pos/checkout', superAdminMiddleware, async (req, res) => {
  try {
    const { items, total, paymentMethod } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Cart is empty' });
    }
    if (total === undefined || total === null || isNaN(Number(total))) {
      return res.status(400).json({ success: false, error: 'Valid total is required' });
    }
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const count = await db.collection('posTransactions').countDocuments({});
    const doc = {
      transactionId: String(9000 + count + 1),
      items: items.map(i => ({ name: i.name, price: i.price, quantity: i.quantity })),
      total: Number(total),
      paymentMethod: paymentMethod || 'Cash',
      status: 'completed',
      createdAt: new Date()
    };
    await db.collection('posTransactions').insertOne(doc);
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error('POS checkout error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ SMS GATEWAY — configuration storage + logs (no real provider integration configured)
app.get('/api/sms-gateway/config', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: {} });
    const config = await db.collection('smsGatewayConfig').findOne({ _id: 'singleton' });
    res.json({ success: true, data: config || {} });
  } catch (err) {
    console.error('Get SMS gateway config error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/sms-gateway/config', superAdminMiddleware, async (req, res) => {
  try {
    const { provider, apiKey, apiSecret, senderId, testNumber, isActive } = req.body;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const updateData = {
      provider: provider || 'twilio',
      apiKey: apiKey || '',
      apiSecret: apiSecret || '',
      senderId: senderId || '',
      testNumber: testNumber || '',
      isActive: isActive !== false,
      updatedAt: new Date()
    };
    await db.collection('smsGatewayConfig').updateOne(
      { _id: 'singleton' },
      { $set: updateData },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save SMS gateway config error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sms-gateway/logs', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const logs = await db.collection('smsGatewayLogs').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ success: true, data: logs.map(l => ({ to: l.to, status: l.status, createdAt: l.createdAt })) });
  } catch (err) {
    console.error('Get SMS gateway logs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Honest: no real SMS provider (Twilio/MSG91/Africa's Talking) SDK is integrated in this
// environment. We log the attempt for visibility but do not fabricate a successful send.
app.post('/api/sms-gateway/test', superAdminMiddleware, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ success: false, error: 'Phone number is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    await db.collection('smsGatewayLogs').insertOne({
      to,
      status: 'failed',
      reason: 'No SMS provider integration configured',
      createdAt: new Date()
    });

    res.status(503).json({ success: false, error: 'No SMS provider is connected yet. Add real Twilio/MSG91 credentials and enable provider integration to send SMS.' });
  } catch (err) {
    console.error('Test SMS error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ PWA SETTINGS — manifest configuration (MongoDB backed)
app.get('/api/pwa/settings', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: {} });
    const settings = await db.collection('pwaSettings').findOne({ _id: 'singleton' });
    res.json({ success: true, data: settings || {} });
  } catch (err) {
    console.error('Get PWA settings error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/pwa/settings', superAdminMiddleware, async (req, res) => {
  try {
    const { appName, shortName, description, themeColor, bgColor, iconUrl, startUrl, displayMode, orientation, offlineSupport } = req.body;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const updateData = {
      appName: appName || 'My Hotel App',
      shortName: shortName || 'Hotel',
      description: description || 'Hotel Management System',
      themeColor: themeColor || '#6c63ff',
      bgColor: bgColor || '#ffffff',
      iconUrl: iconUrl || '',
      startUrl: startUrl || '/',
      displayMode: ['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(displayMode) ? displayMode : 'standalone',
      orientation: ['any', 'portrait', 'landscape'].includes(orientation) ? orientation : 'any',
      offlineSupport: offlineSupport !== false,
      updatedAt: new Date()
    };
    await db.collection('pwaSettings').updateOne(
      { _id: 'singleton' },
      { $set: updateData },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save PWA settings error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ PAYMENT GATEWAYS — configuration storage + CRUD (no real provider SDK integrated)
app.get('/api/payment-gateways', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const gateways = await db.collection('paymentGateways').find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).toArray();
    const formatted = gateways.map(g => ({
      _id: g._id.toString(),
      name: g.name,
      provider: g.provider,
      mode: g.mode,
      currency: g.currency,
      fee: g.fee,
      apiKey: g.apiKey,
      apiSecret: g.apiSecret,
      isActive: g.isActive,
      icon: g.icon
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get payment gateways error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/payment-gateways/:id', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const gateway = await db.collection('paymentGateways').findOne({ _id: new ObjectId(req.params.id) });
    if (!gateway) return res.status(404).json({ success: false, error: 'Gateway not found' });
    res.json({ success: true, data: { ...gateway, _id: gateway._id.toString() } });
  } catch (err) {
    console.error('Get payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/payment-gateways', superAdminMiddleware, async (req, res) => {
  try {
    const { name, provider, mode, currency, fee, apiKey, apiSecret, isActive, icon } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      name: String(name).trim(),
      provider: provider || 'stripe',
      mode: mode === 'live' ? 'live' : 'test',
      currency: currency || 'USD',
      fee: parseFloat(fee) || 0,
      apiKey: apiKey || '',
      apiSecret: apiSecret || '',
      isActive: isActive !== false,
      icon: icon || '💳',
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('paymentGateways').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), ...doc } });
  } catch (err) {
    console.error('Create payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/payment-gateways/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { name, provider, mode, currency, fee, apiKey, apiSecret, isActive, icon } = req.body;
    const updateData = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = String(name).trim();
    if (provider !== undefined) updateData.provider = provider;
    if (mode !== undefined) updateData.mode = mode === 'live' ? 'live' : 'test';
    if (currency !== undefined) updateData.currency = currency;
    if (fee !== undefined) updateData.fee = parseFloat(fee) || 0;
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (apiSecret !== undefined) updateData.apiSecret = apiSecret;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (icon !== undefined) updateData.icon = icon;
    const result = await db.collection('paymentGateways').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Gateway not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/payment-gateways/:id/toggle', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const gateway = await db.collection('paymentGateways').findOne({ _id: new ObjectId(id) });
    if (!gateway) return res.status(404).json({ success: false, error: 'Gateway not found' });
    const newStatus = !gateway.isActive;
    await db.collection('paymentGateways').updateOne({ _id: new ObjectId(id) }, { $set: { isActive: newStatus } });
    res.json({ success: true, data: { isActive: newStatus } });
  } catch (err) {
    console.error('Toggle payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/payment-gateways/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('paymentGateways').updateOne({ _id: new ObjectId(id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Gateway not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Honest: no real payment provider SDK (Stripe/PayPal/Razorpay) is integrated in this
// environment, so we cannot fabricate a successful connection test.
app.post('/api/payment-gateways/:id/test', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const gateway = await db.collection('paymentGateways').findOne({ _id: new ObjectId(id) });
    if (!gateway) return res.status(404).json({ success: false, error: 'Gateway not found' });
    res.status(503).json({ success: false, error: `No real ${gateway.provider} SDK is connected yet. Add real API credentials and enable provider integration to test this gateway.` });
  } catch (err) {
    console.error('Test payment gateway error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ WHITE LABEL — branding configuration (MongoDB backed)
app.get('/api/white-label', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: {} });
    const config = await db.collection('whiteLabelConfig').findOne({ _id: 'singleton' });
    res.json({ success: true, data: config || {} });
  } catch (err) {
    console.error('Get white-label config error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/white-label', superAdminMiddleware, async (req, res) => {
  try {
    const { brandName, logo, favicon, primaryColor, secondaryColor, customDomain, footerText, isActive } = req.body;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const updateData = {
      brandName: brandName || 'Default Brand',
      logo: logo || '',
      favicon: favicon || '',
      primaryColor: primaryColor || '#6c63ff',
      secondaryColor: secondaryColor || '#a78bfa',
      customDomain: customDomain || '',
      footerText: footerText || 'Default footer',
      isActive: isActive !== false,
      updatedAt: new Date()
    };
    await db.collection('whiteLabelConfig').updateOne(
      { _id: 'singleton' },
      { $set: updateData },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save white-label config error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ NOTIFICATIONS CENTER — admin notifications (MongoDB backed)
app.get('/api/notifications', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const notifs = await db.collection('adminNotifications').find({}).sort({ createdAt: -1 }).limit(100).toArray();
    const formatted = notifs.map(n => ({
      _id: n._id.toString(),
      title: n.title,
      message: n.message,
      type: n.type || 'info',
      isRead: !!n.isRead,
      createdAt: n.createdAt
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/notifications/:id/read', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('adminNotifications').updateOne({ _id: new ObjectId(id) }, { $set: { isRead: true } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/notifications/read-all', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    await db.collection('adminNotifications').updateMany({ isRead: { $ne: true } }, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/notifications/clear', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    await db.collection('adminNotifications').deleteMany({});
    res.json({ success: true });
  } catch (err) {
    console.error('Clear notifications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/notifications/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('adminNotifications').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ KANBAN BOARD — internal task tracker (MongoDB backed)
app.get('/api/kanban', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const tasks = await db.collection('kanbanTasks').find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).toArray();
    const formatted = tasks.map(t => ({
      _id: t._id.toString(),
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      assignee: t.assignee,
      createdAt: t.createdAt
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get kanban tasks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/kanban/:id', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const task = await db.collection('kanbanTasks').findOne({ _id: new ObjectId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: { ...task, _id: task._id.toString() } });
  } catch (err) {
    console.error('Get kanban task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/kanban', superAdminMiddleware, async (req, res) => {
  try {
    const { title, description, priority, status, assignee } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ success: false, error: 'Title is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const validColumns = ['To Do', 'In Progress', 'Review', 'Done'];
    const doc = {
      title: String(title).trim(),
      description: description || '',
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'low',
      status: validColumns.includes(status) ? status : 'To Do',
      assignee: assignee || '',
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('kanbanTasks').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), ...doc } });
  } catch (err) {
    console.error('Create kanban task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/kanban/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { title, description, priority, status, assignee } = req.body;
    const validColumns = ['To Do', 'In Progress', 'Review', 'Done'];
    const updateData = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = String(title).trim();
    if (description !== undefined) updateData.description = description;
    if (priority !== undefined) updateData.priority = ['low', 'medium', 'high'].includes(priority) ? priority : 'low';
    if (status !== undefined) updateData.status = validColumns.includes(status) ? status : 'To Do';
    if (assignee !== undefined) updateData.assignee = assignee;
    const result = await db.collection('kanbanTasks').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update kanban task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/kanban/:id/status', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validColumns = ['To Do', 'In Progress', 'Review', 'Done'];
    if (!validColumns.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('kanbanTasks').updateOne({ _id: new ObjectId(id) }, { $set: { status } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update kanban task status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/kanban/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('kanbanTasks').updateOne({ _id: new ObjectId(id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete kanban task error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ CALENDAR — internal event tracker (MongoDB backed)
app.get('/api/calendar/events', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const events = await db.collection('calendarEvents').find({ isDeleted: { $ne: true } }).sort({ date: 1 }).toArray();
    const formatted = events.map(e => ({
      _id: e._id.toString(),
      title: e.title,
      date: e.date,
      type: e.type,
      description: e.description
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Get calendar events error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/calendar/events', superAdminMiddleware, async (req, res) => {
  try {
    const { title, date, type, description } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ success: false, error: 'Title is required' });
    if (!date) return res.status(400).json({ success: false, error: 'Date is required' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const doc = {
      title: String(title).trim(),
      date,
      type: ['booking', 'task', 'other'].includes(type) ? type : 'other',
      description: description || '',
      isDeleted: false,
      createdAt: new Date()
    };
    const result = await db.collection('calendarEvents').insertOne(doc);
    res.status(201).json({ success: true, data: { _id: result.insertedId.toString(), ...doc } });
  } catch (err) {
    console.error('Create calendar event error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/calendar/events/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const { title, date, type, description } = req.body;
    const updateData = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = String(title).trim();
    if (date !== undefined) updateData.date = date;
    if (type !== undefined) updateData.type = ['booking', 'task', 'other'].includes(type) ? type : 'other';
    if (description !== undefined) updateData.description = description;
    const result = await db.collection('calendarEvents').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Update calendar event error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/calendar/events/:id', superAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });
    const result = await db.collection('calendarEvents').updateOne({ _id: new ObjectId(id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete calendar event error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ IMPORT / EXPORT — bulk data import (CSV/Excel/JSON) and export (MongoDB backed)
const multer = require('multer');
const XLSX = require('xlsx');
const importExportUpload = multer({ storage: multer.memoryStorage() });

const IMPORT_EXPORT_COLLECTION_MAP = {
  hotels: 'tenants',
  rooms: 'rooms',
  guests: 'guests',
  bookings: 'bookings',
  staff: 'staff'
};

function stripSensitiveFields(obj) {
  const clean = { ...obj };
  Object.keys(clean).forEach(key => {
    if (/pass|secret|token/i.test(key)) delete clean[key];
  });
  return clean;
}

app.get('/api/import-export/history', superAdminMiddleware, async (req, res) => {
  try {
    if (!dbConnected) return res.json({ success: true, data: [] });
    const history = await db.collection('importExportHistory').find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ success: true, data: history.map(h => ({ type: h.type, table: h.table, status: h.status, records: h.records, createdAt: h.createdAt })) });
  } catch (err) {
    console.error('Get import/export history error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/import-export/import', superAdminMiddleware, importExportUpload.array('files'), async (req, res) => {
  try {
    const { type } = req.body;
    const collectionName = IMPORT_EXPORT_COLLECTION_MAP[type];
    if (!collectionName) return res.status(400).json({ success: false, error: 'Invalid import type' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No file uploaded' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    let allRows = [];
    for (const file of req.files) {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      allRows = allRows.concat(rows);
    }

    let validRows = [];
    let skipped = 0;

    if (type === 'hotels') {
      validRows = allRows.filter(r => r.hotelId && r.hotelName);
      skipped = allRows.length - validRows.length;
      validRows = validRows.map(r => ({ ...r, active: true, createdAt: new Date() }));
    } else {
      validRows = allRows.filter(r => r.hotelId);
      skipped = allRows.length - validRows.length;
      validRows = validRows.map(r => ({ ...r, createdAt: new Date() }));
    }

    let insertedCount = 0;
    if (validRows.length > 0) {
      const result = await db.collection(collectionName).insertMany(validRows, { ordered: false });
      insertedCount = result.insertedCount;
    }

    await db.collection('importExportHistory').insertOne({
      type: 'import',
      table: type,
      status: insertedCount > 0 ? 'success' : 'failed',
      records: insertedCount,
      skipped,
      createdAt: new Date()
    });

    if (insertedCount === 0) {
      return res.status(400).json({
        success: false,
        error: skipped > 0
          ? `No rows imported. ${skipped} row(s) were missing a required hotelId column.`
          : 'No valid rows found in the uploaded file.'
      });
    }

    res.json({ success: true, records: insertedCount, skipped });
  } catch (err) {
    console.error('Import data error:', err);
    try {
      await db.collection('importExportHistory').insertOne({ type: 'import', table: req.body?.type || 'unknown', status: 'failed', records: 0, createdAt: new Date() });
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/import-export/export', superAdminMiddleware, async (req, res) => {
  try {
    const { table, format } = req.query;
    const collectionName = IMPORT_EXPORT_COLLECTION_MAP[table];
    if (!collectionName) return res.status(400).json({ success: false, error: 'Invalid export table' });
    if (!dbConnected) return res.status(503).json({ success: false, error: 'Database not connected' });

    const docs = await db.collection(collectionName).find({}).toArray();
    const rows = docs.map(d => stripSensitiveFields({ ...d, _id: d._id.toString() }));

    let buffer, contentType, ext;
    if (format === 'json') {
      buffer = Buffer.from(JSON.stringify(rows, null, 2));
      contentType = 'application/json';
      ext = 'json';
    } else if (format === 'excel') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, table);
      buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      ext = 'xlsx';
    } else {
      const ws = XLSX.utils.json_to_sheet(rows);
      buffer = Buffer.from(XLSX.utils.sheet_to_csv(ws));
      contentType = 'text/csv';
      ext = 'csv';
    }

    await db.collection('importExportHistory').insertOne({
      type: 'export', table, status: 'success', records: rows.length, createdAt: new Date()
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${table}_export.${ext}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export data error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ GLOBAL CONFIG — default hotel, plan prices, currencies (MongoDB backed)
const DEFAULT_GLOBAL_CONFIG = {
  defaultHotelId: 'HOTEL001',
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

// ======================== UPGRADE OPTIONS ========================
app.get('/api/upgrade-options', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json([]);
    const data = await db.collection('upgradeOptions').find({ hotelId }).sort({ _id: -1 }).toArray();
    data.forEach(d => { if (d._id) d._id = d._id.toString(); });
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/upgrade-options', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const entry = { hotelId, ...req.body, _version: 1 };
    if (!dbConnected) { entry._id = 'upg_'+Date.now(); return res.status(201).json({ ...entry, success: true }); }
    const result = await db.collection('upgradeOptions').insertOne(entry);
    entry._id = result.insertedId.toString();
    broadcast(hotelId, 'upgrade_upd', entry, req.clientId);
    res.status(201).json({ ...entry, success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/upgrade-options/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    const update = { ...req.body }; delete update._id;
    await db.collection('upgradeOptions').updateOne({ _id: parseId(id), hotelId }, { $set: update });
    broadcast(hotelId, 'upgrade_upd', { _id: id, hotelId, ...update }, req.clientId);
    res.json({ success: true, _id: id, ...update });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/upgrade-options/:id', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { id } = req.params;
    if (!dbConnected) return res.json({ success: true });
    await db.collection('upgradeOptions').deleteOne({ _id: parseId(id), hotelId });
    broadcast(hotelId, 'upgrade_upd', { _id: id, hotelId, deleted: true }, req.clientId);
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

// ======================== SERVER START (RENDER SAFE) ========================

const PORT = process.env.PORT || 3000;

// 1. Pehle Server ko Port par listen karwayein (Render health check ke liye zaroori)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running and listening on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`✅ Guest Hub Module Loaded Successfully!`);
  console.log(`📡 Socket.io: Enabled`);

  // 2. Background mein Database connect karein
  connectDB()
    .then(() => {
      console.log('✅ MongoDB Connected Successfully in background');
    })
    .catch(err => {
      console.error('❌ MongoDB connection failed:', err.message);
      console.log('⚠️ Server is still running, but database features will not work.');
      // process.exit(1) hata diya hai taaki server crash na ho aur Render 502 na de
    });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ FATAL: Port ${PORT} is already in use.`);
    process.exit(1);
  }
  console.error('❌ Server startup error:', err);
  process.exit(1);
});

// ======================== GRACEFUL SHUTDOWN ========================
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    const { disconnectDB } = require('./config/db');
    await disconnectDB();
  } catch (e) {}
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    const { disconnectDB } = require('./config/db');
    await disconnectDB();
  } catch (e) {}
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
  // process.exit(1); // Render ke liye sometimes better to just log
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});
