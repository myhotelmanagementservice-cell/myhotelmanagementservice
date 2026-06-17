require("dotenv").config({ path: __dirname + "/.env" });
// server.js - Complete Multi-Tenant Hotel SaaS Backend (ADVANCED - PRODUCTION READY v2.0)
const express = require('express');
const session = require('express-session');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ✅ NEW: Advanced middleware imports
let compression, helmet, rateLimit;
try { compression = require('compression'); } catch(e) { compression = null; }
try { helmet = require('helmet'); } catch(e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch(e) { rateLimit = null; }

const app = express();
const server = http.createServer(app);

// ✅ Socket.io Setup with CORS for multi-origin support
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// ==================== ADVANCED MIDDLEWARE ====================

// ✅ NEW: Compression for faster responses
if (compression) {
  app.use(compression());
  console.log('✅ Compression enabled');
}

// ✅ NEW: Security headers (Helmet) - configured for SPA compatibility
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP to avoid blocking frontend assets
    crossOriginEmbedderPolicy: false
  }));
  console.log('✅ Helmet security headers enabled');
}

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-hotel-id', 'x-client-id', 'x-idempotency-key', 'x-request-id']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ Static file path - supports both root and inaya-hotel folder
const publicPath = path.join(__dirname, process.env.PUBLIC_PATH || '../public');
app.use(express.static(publicPath, {
  maxAge: '1h',           // Cache static assets
  etag: true,
  lastModified: true
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'inaya-hotel-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false, // ✅ FIXED: Don't save empty sessions
  rolling: true,            // ✅ NEW: Reset expiry on each request (keeps session alive on activity)
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000 // 7 days default
  }
}));

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';

// ✅ NEW: Idle timeout configuration (in milliseconds)
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS) || 30 * 60 * 1000; // 30 minutes default
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';
const TOKEN_REFRESH_THRESHOLD_MS = parseInt(process.env.TOKEN_REFRESH_THRESHOLD_MS) || 60 * 60 * 1000; // Refresh if <1hr left

let db;
let client;
let dbConnected = false;
let dbReconnectTimer = null;

// ✅ NEW: In-memory store for idempotency keys (clears old ones every hour)
const idempotencyStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Remove keys older than 24h
  for (const [key, val] of idempotencyStore.entries()) {
    if (val.timestamp < cutoff) idempotencyStore.delete(key);
  }
}, 60 * 60 * 1000);

// ==================== MONGODB CONNECTION ====================
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    if (dbReconnectTimer) { clearTimeout(dbReconnectTimer); dbReconnectTimer = null; }

    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
      retryWrites: true,
      retryReads: true
    });

    await client.connect();
    db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    dbConnected = true;
    console.log('✅ MongoDB Connected Successfully!');

    // ✅ NEW: Monitor connection events
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

// ✅ FIXED: Index creation with KEY PATTERN check
async function createIndexes() {
  try {
    // ✅ ADDED: announcements, policies, config collections
    const collections = ['rooms', 'guests', 'food', 'inventory', 'requests', 'blacklist', 'maintenance', 'reviews', 'loyalty', 'staff', 'logs', 'settings', 'tenants', 'bookings', 'users', 'sessions', 'announcements', 'policies', 'config'];

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
      if (col === 'settings' && !indexExistsWithKeys({ hotelId: 1 })) {
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
      // ✅ NEW: Sessions index for TTL auto-cleanup
      if (col === 'sessions' && !indexExistsWithKeys({ lastActivity: 1 })) {
        await collection.createIndex({ lastActivity: 1 }, { expireAfterSeconds: Math.floor(IDLE_TIMEOUT_MS / 1000) + 3600 });
      }
      // ✅ NEW: Announcements indexes
      if (col === 'announcements' && !indexExistsWithKeys({ category: 1, hotelId: 1 })) {
        await collection.createIndex({ category: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'announcements' && !indexExistsWithKeys({ isActive: 1, hotelId: 1 })) {
        await collection.createIndex({ isActive: 1, hotelId: 1 }, { background: true });
      }
      // ✅ NEW: Policies indexes
      if (col === 'policies' && !indexExistsWithKeys({ type: 1, hotelId: 1 })) {
        await collection.createIndex({ type: 1, hotelId: 1 }, { background: true });
      }
      if (col === 'policies' && !indexExistsWithKeys({ isEnabled: 1, hotelId: 1 })) {
        await collection.createIndex({ isEnabled: 1, hotelId: 1 }, { background: true });
      }
      // ✅ NEW: Config indexes
      if (col === 'config' && !indexExistsWithKeys({ hotelId: 1 })) {
        await collection.createIndex({ hotelId: 1 }, { unique: true, background: true });
      }
    }
    console.log('✅ All indexes verified/created successfully');
  } catch (e) {
    console.log(`ℹ️ Index setup note: ${e.message}`);
  }
}

// ==================== RATE LIMITING ====================
// ✅ NEW: Rate limiting to prevent abuse
let loginLimiter, apiLimiter;
if (rateLimit) {
  loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,                   // Max 20 login attempts per window
    message: { success: false, error: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip + '_' + (req.body?.email || '')
  });

  apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300,                  // 300 requests per minute per IP
    message: { success: false, error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET' // Only limit write operations
  });

  app.use('/api/', apiLimiter);
  console.log('✅ Rate limiting enabled');
}

// ==================== MULTI-TENANT MIDDLEWARE ====================
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

// ✅ NEW: Idempotency middleware - prevents duplicate POSTs on retry
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

// ✅ Subscription Expiry Validation Middleware
const checkSubscription = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;
    if (hotelId === 'HOTEL001') return next();
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

app.use('/api/rooms', checkSubscription);
app.use('/api/guests', checkSubscription);
app.use('/api/food', checkSubscription);
app.use('/api/inventory', checkSubscription);
app.use('/api/requests', checkSubscription);
app.use('/api/bookings', checkSubscription);
app.use('/api/staff', checkSubscription);
// ✅ NEW: Add subscription check for new routes
app.use('/api/announcements', checkSubscription);
app.use('/api/policies', checkSubscription);
app.use('/api/config', checkSubscription);

// ==================== AUTH UTILITIES ====================
const generateToken = (payload, expiresIn = TOKEN_EXPIRY) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// ✅ NEW: Decode token without verification (to check expiry before verifying)
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

    // ✅ NEW: Auto-refresh token if expiry is close
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

// ==================== ✅ NEW: IDLE SESSION MANAGEMENT ====================

// Track active sessions (in-memory + DB for persistence)
const activeSessions = new Map(); // token -> { lastActivity, hotelId, userId }

// ✅ NEW: Update session activity on every authenticated request
const updateSessionActivity = async (req) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !req.user) return;

  const sessionKey = token.substring(token.length - 32); // Use last 32 chars as key
  activeSessions.set(sessionKey, {
    lastActivity: Date.now(),
    hotelId: req.hotelId,
    email: req.user?.email
  });

  // Update in DB if connected (async, non-blocking)
  if (dbConnected) {
    db.collection('sessions').updateOne(
      { sessionKey },
      { $set: { lastActivity: new Date(), hotelId: req.hotelId, email: req.user?.email } },
      { upsert: true }
    ).catch(() => {});
  }
};

// ✅ NEW: Check if session is idle
const checkIdleTimeout = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();

  const sessionKey = token.substring(token.length - 32);
  const session = activeSessions.get(sessionKey);

  if (session) {
    const idleTime = Date.now() - session.lastActivity;
    if (idleTime > IDLE_TIMEOUT_MS) {
      activeSessions.delete(sessionKey);
      // Clean from DB
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

  // Update activity
  updateSessionActivity(req);
  next();
};

// Apply idle check to authenticated routes
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
// ✅ NEW: Add idle check for new routes
app.use('/api/announcements', checkIdleTimeout);
app.use('/api/policies', checkIdleTimeout);
app.use('/api/config', checkIdleTimeout);

// ✅ NEW: Periodic cleanup of stale in-memory sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of activeSessions.entries()) {
    if (now - val.lastActivity > IDLE_TIMEOUT_MS + 60000) {
      activeSessions.delete(key);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ==================== SOCKET.IO REAL-TIME ====================
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // ✅ Support both snake_case and camelCase event names
  socket.on('join_hotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`📡 ${socket.id} joined room: hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected to hotel channel' });
  });

  socket.on('joinHotel', (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    socket.emit('connected', { hotelId, message: 'Connected' });
  });

  // ✅ NEW: Heartbeat to keep connection alive and detect stale clients
  socket.on('ping_heartbeat', (data) => {
    socket.emit('pong_heartbeat', { serverTime: new Date().toISOString(), received: data });
  });

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

  socket.on('req_new', (payload) => broadcastEvent('req_new', payload));
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
  socket.on('review_new', (payload) => broadcastEvent('review_new', payload));
  // ✅ NEW: Socket events for announcements and policies
  socket.on('announcement_upd', (payload) => broadcastEvent('announcement_upd', payload));
  socket.on('policy_upd', (payload) => broadcastEvent('policy_upd', payload));

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

const broadcast = (hotelId, event, data, clientId = null) => {
  const payload = {
    data,
    hotelId,
    clientId,
    syncToken: Date.now()
  };
  io.to(`hotel_${hotelId}`).emit(event, payload);
};

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    message: 'Inaya Hotel Management System API',
    status: 'OK',
    version: '2.0.0',
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

// ✅ NEW: Token validation + refresh endpoint (frontend calls this on page load)
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

    // Check idle timeout
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

    // Auto-refresh if token expiry is close
    let newToken = null;
    if (exp - now < TOKEN_REFRESH_THRESHOLD_MS) {
      const { iat, exp: _exp, ...rest } = decoded;
      newToken = generateToken(rest);
    }

    // Register session activity
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
      newToken // Frontend should update stored token if this is present
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.json({ success: false, valid: false, code: 'TOKEN_EXPIRED' });
    }
    return res.json({ success: false, valid: false, code: 'INVALID_TOKEN' });
  }
});

// ✅ NEW: Idle timeout config endpoint (frontend reads this on load)
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

// ✅ NEW: Explicit session keep-alive ping (frontend calls this on user activity)
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

    const tenant = {
      hotelId, hotelName, logo: logo || null,
      currency: currency || 'USD', currencySymbol: currencySymbol || '$',
      language: language || 'en', country: country || 'Unknown',
      timezone: timezone || 'UTC', active: true,
      theme: theme || 'HOTEL001', subscriptionType: subscriptionType || 'basic',
      subscriptionExpiry, createdAt: new Date(), updatedAt: new Date()
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
      hotelId, hotelName,
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
      db.collection('settings').deleteOne({ hotelId }),
      db.collection('users').deleteMany({ hotelId }),
      // ✅ NEW: Delete from new collections
      db.collection('announcements').deleteMany({ hotelId }),
      db.collection('policies').deleteMany({ hotelId }),
      db.collection('config').deleteMany({ hotelId })
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

// ==================== AUTHENTICATION ====================
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
    res.status(201).json({ success: true, message: 'Admin created', data: user });
  } catch (error) {
    console.error('Admin register error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Apply rate limiting to login route
app.post('/api/admin/login', loginLimiter || ((req, res, next) => next()), async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;
    console.log('🔐 Admin login attempt:', email, 'for hotel:', hotelId);

    if (!dbConnected) {
      if (email === 'admin@crownplaza.com' && password === 'admin123') {
        const tokenPayload = {
          email, name: 'Admin', role: 'super_admin',
          hotelId: hotelId || 'HOTEL001',
          permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings']
        };
        const token = generateToken(tokenPayload);
        // Register session
        const sessionKey = token.substring(token.length - 32);
        activeSessions.set(sessionKey, { lastActivity: Date.now(), hotelId: hotelId || 'HOTEL001', email });

        req.session.isAdmin = true;
        req.session.adminEmail = email;
        req.session.hotelId = hotelId || 'HOTEL001';
        return res.json({
          success: true, token,
          user: { email, name: 'Admin', role: 'super_admin', permissions: ['all'] },
          hotelId: hotelId || 'HOTEL001',
          idleTimeoutMs: IDLE_TIMEOUT_MS
        });
      }
      return res.status(503).json({ success: false, error: 'Database connecting...' });
    }

    if (hotelId && hotelId !== 'HOTEL001') {
      const tenant = await db.collection('tenants').findOne({ hotelId });
      if (!tenant) {
        await db.collection('tenants').insertOne({
          hotelId, hotelName: 'New Hotel', currency: 'USD',
          currencySymbol: '$', language: 'en', country: 'Unknown',
          active: true, theme: 'HOTEL001', subscriptionType: 'basic', createdAt: new Date()
        });
      }
    }

    const user = await db.collection('users').findOne({
      email,
      $or: [{ hotelId }, { hotelId: { $exists: false } }]
    });

    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ success: false, error: 'Account is inactive' });

    const tokenPayload = {
      email: user.email, name: user.name, role: user.role,
      hotelId: hotelId || user.hotelId || 'HOTEL001',
      permissions: user.permissions
    };
    const token = generateToken(tokenPayload);

    // ✅ Register session on login
    const sessionKey = token.substring(token.length - 32);
    activeSessions.set(sessionKey, {
      lastActivity: Date.now(),
      hotelId: hotelId || user.hotelId || 'HOTEL001',
      email: user.email
    });

    if (dbConnected) {
      db.collection('sessions').updateOne(
        { sessionKey },
        { $set: { lastActivity: new Date(), hotelId: hotelId || user.hotelId || 'HOTEL001', email: user.email } },
        { upsert: true }
      ).catch(() => {});
    }

    req.session.isAdmin = true;
    req.session.adminEmail = email;
    req.session.hotelId = hotelId || user.hotelId || 'HOTEL001';
    req.session.user = { email: user.email, name: user.name, role: user.role, permissions: user.permissions };

    console.log('✅ Admin login successful:', email);

    res.json({
      success: true, token,
      user: { email: user.email, name: user.name, role: user.role, permissions: user.permissions },
      hotelId: hotelId || user.hotelId || 'HOTEL001',
      idleTimeoutMs: IDLE_TIMEOUT_MS  // ✅ Tell frontend what the idle timeout is
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

      // Check idle timeout
      const sessionKey = token.substring(token.length - 32);
      const session = activeSessions.get(sessionKey);
      if (session) {
        const idleTime = Date.now() - session.lastActivity;
        if (idleTime > IDLE_TIMEOUT_MS) {
          activeSessions.delete(sessionKey);
          return res.json({ success: false, isAdmin: false, code: 'SESSION_IDLE_TIMEOUT' });
        }
        // Update activity
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
  // ✅ Clean up session from memory
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

// ==================== ROOMS CRUD ====================
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
        _id: 'r_'+Date.now(), hotelId, number: parseInt(number), type,
        price: parseFloat(price), status: status || 'Vacant',
        guestName: guestName || null, amenities: amenities || [],
        createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'room_upd', room, req.clientId);
      return res.status(201).json({ success: true, message: 'Room added (offline)', data: room });
    }

    const existing = await db.collection('rooms').findOne({ hotelId, number: parseInt(number) });
    if (existing) return res.status(400).json({ success: false, error: 'Room number already exists' });

    const room = {
      hotelId, number: parseInt(number), type, price: parseFloat(price),
      status: status || 'Vacant', guestName: guestName || null,
      amenities: amenities || [], createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('rooms').insertOne(room);
    room._id = result.insertedId;
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
        _id: id, hotelId,
        number: number ? parseInt(number) : undefined, type,
        price: price ? parseFloat(price) : undefined,
        status, guestName, amenities, updatedAt: new Date()
      };
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

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Room not found' });

    const updatedRoom = await db.collection('rooms').findOne({ _id: new ObjectId(id) });
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
      broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Room deleted (offline)' });
    }

    const result = await db.collection('rooms').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Room not found' });

    broadcast(hotelId, 'room_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Room deleted' });
  } catch (error) {
    console.error('Room delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GUESTS CRUD ====================
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
      return res.status(201).json({ success: true, message: 'Guest added (offline)', data: guest });
    }

    const guest = {
      hotelId, name, email: email || null, phone: phone || null,
      room: parseInt(room), checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      points: points || 0, status: status || 'active',
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('guests').insertOne(guest);
    guest._id = result.insertedId;
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
        _id: id, hotelId, name, email, phone,
        room: room ? parseInt(room) : undefined,
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut !== undefined ? (checkOut ? new Date(checkOut) : null) : undefined,
        points: points !== undefined ? parseInt(points) : undefined,
        status, updatedAt: new Date()
      };
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

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Guest not found' });

    const updatedGuest = await db.collection('guests').findOne({ _id: new ObjectId(id) });
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
      broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Guest deleted (offline)' });
    }

    const result = await db.collection('guests').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Guest not found' });

    broadcast(hotelId, 'guest_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Guest deleted' });
  } catch (error) {
    console.error('Guest delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FOOD MENU CRUD ====================
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

    if (!name || !price) return res.status(400).json({ success: false, error: 'name and price are required' });

    if (!dbConnected) {
      const item = {
        _id: 'f_'+Date.now(), hotelId, name, price: parseFloat(price),
        category: category || 'Main Course', description: description || '',
        available: available !== false, image: image || null,
        createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'food_upd', item, req.clientId);
      return res.status(201).json({ success: true, message: 'Food item added (offline)', data: item });
    }

    const item = {
      hotelId, name, price: parseFloat(price),
      category: category || 'Main Course', description: description || '',
      available: available !== false, image: image || null,
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('food').insertOne(item);
    item._id = result.insertedId;
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
        _id: id, hotelId, name,
        price: price ? parseFloat(price) : undefined,
        category, description, available, image, updatedAt: new Date()
      };
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

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Food item not found' });

    const updatedItem = await db.collection('food').findOne({ _id: new ObjectId(id) });
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
      broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Food item deleted (offline)' });
    }

    const result = await db.collection('food').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Food item not found' });

    broadcast(hotelId, 'food_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Food item deleted' });
  } catch (error) {
    console.error('Food delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== INVENTORY CRUD ====================
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

    const autoStatus = parseInt(quantity) <= 0 ? 'out-of-stock'
      : parseInt(quantity) <= (parseInt(minStock) || 10) ? 'low-stock' : 'in-stock';

    if (!dbConnected) {
      const item = {
        _id: 'i_'+Date.now(), hotelId, name, category,
        quantity: parseInt(quantity), minStock: parseInt(minStock) || 10,
        price: price ? parseFloat(price) : 0, unit: unit || 'pcs',
        status: status || autoStatus, createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'inventory_upd', item, req.clientId);
      return res.status(201).json({ success: true, message: 'Inventory item added (offline)', data: item });
    }

    const item = {
      hotelId, name, category, quantity: parseInt(quantity),
      minStock: parseInt(minStock) || 10, price: price ? parseFloat(price) : 0,
      unit: unit || 'pcs', status: status || autoStatus,
      createdAt: new Date(), updatedAt: new Date()
    };

    const result = await db.collection('inventory').insertOne(item);
    item._id = result.insertedId;
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

    const autoStatus = () => {
      if (quantity === undefined) return undefined;
      const qty = parseInt(quantity);
      const min = parseInt(minStock) || 10;
      return qty <= 0 ? 'out-of-stock' : qty <= min ? 'low-stock' : 'in-stock';
    };

    if (!dbConnected) {
      const updatedItem = {
        _id: id, hotelId, name, category,
        quantity: quantity !== undefined ? parseInt(quantity) : undefined,
        minStock: minStock !== undefined ? parseInt(minStock) : undefined,
        price: price !== undefined ? parseFloat(price) : undefined,
        unit, status: status || autoStatus(), updatedAt: new Date()
      };
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

    const computed = autoStatus();
    if (computed) updateData.status = computed;

    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Inventory item not found' });

    const updatedItem = await db.collection('inventory').findOne({ _id: new ObjectId(id) });
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
      broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Inventory item deleted (offline)' });
    }

    const result = await db.collection('inventory').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Inventory item not found' });

    broadcast(hotelId, 'inventory_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Inventory item deleted' });
  } catch (error) {
    console.error('Inventory delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVICE REQUESTS CRUD ====================
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
        _id: 'req_'+Date.now(), hotelId, guestName,
        roomNumber: parseInt(roomNumber), department,
        category: category || 'General', description: description || '',
        priority: priority || 'normal', status: 'open',
        type: type || 'service', items: items || [],
        totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
        assignedTo: null, createdAt: new Date(), updatedAt: new Date()
      };
      broadcast(hotelId, 'req_new', request, req.clientId);
      return res.status(201).json({ success: true, message: 'Request submitted (offline)', data: request });
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
    request._id = result.insertedId;
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
        _id: id, hotelId, status, priority, assignedTo,
        notes: notes ? (notes + '\n[' + new Date().toISOString() + ']') : undefined,
        updatedAt: new Date()
      };
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

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Request not found' });

    const updatedRequest = await db.collection('requests').findOne({ _id: new ObjectId(id) });
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
      broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
      return res.json({ success: true, message: 'Request deleted (offline)' });
    }

    const result = await db.collection('requests').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Request not found' });

    broadcast(hotelId, 'req_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Request deleted' });
  } catch (error) {
    console.error('Request delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SETTINGS ====================
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

    if (!dbConnected) return res.json({ success: true, data: defaultSettings });

    const settings = await db.collection('settings').findOne({ hotelId });
    res.json({ success: true, data: settings || defaultSettings });
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
      return res.json({ success: true, message: 'Settings saved (offline)', data: updatedSettings });
    }

    const updateData = { ...settings, hotelId, updatedAt: new Date() };
    await db.collection('settings').updateOne({ hotelId }, { $set: updateData }, { upsert: true });

    const updatedSettings = await db.collection('settings').findOne({ hotelId });
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

// ==================== BOOKINGS CRUD ====================
app.get('/api/bookings', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const bookings = await db.collection('bookings').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: bookings, count: bookings.length });
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
      return res.status(201).json({ success: true, message: 'Booking added (offline)', data: booking });
    }

    const result = await db.collection('bookings').insertOne(booking);
    booking._id = result.insertedId;
    broadcast(hotelId, 'booking_new', booking, req.clientId);
    res.status(201).json({ success: true, message: 'Booking added', data: booking });
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
      return res.json({ success: true, message: 'Booking updated (offline)', data: updatedBooking });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(status && { status }),
      ...(guests !== undefined && { guests: parseInt(guests) }),
      ...(checkIn && { checkIn }),
      ...(checkOut && { checkOut }),
      ...(totalPriceSAR !== undefined && { totalPriceSAR: parseFloat(totalPriceSAR) })
    };

    const result = await db.collection('bookings').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Booking not found' });

    const updatedBooking = await db.collection('bookings').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'booking_upd', updatedBooking, req.clientId);
    res.json({ success: true, message: 'Booking updated', data: updatedBooking });
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

    const result = await db.collection('bookings').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Booking not found' });

    broadcast(hotelId, 'booking_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    console.error('Booking delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== BLACKLIST CRUD ====================
app.get('/api/blacklist', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const blacklist = await db.collection('blacklist').find({ hotelId }).sort({ date: -1 }).toArray();
    res.json({ success: true, data: blacklist, count: blacklist.length });
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
      return res.status(201).json({ success: true, message: 'Guest blocked (offline)', data: entry });
    }

    const result = await db.collection('blacklist').insertOne(entry);
    entry._id = result.insertedId;
    broadcast(hotelId, 'blacklist_upd', entry, req.clientId);
    res.status(201).json({ success: true, message: 'Guest blocked', data: entry });
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

    const result = await db.collection('blacklist').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Entry not found' });

    broadcast(hotelId, 'blacklist_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Guest unblocked' });
  } catch (error) {
    console.error('Blacklist delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== MAINTENANCE CRUD ====================
app.get('/api/maintenance', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const maintenance = await db.collection('maintenance').find({ hotelId }).sort({ scheduled: 1 }).toArray();
    res.json({ success: true, data: maintenance, count: maintenance.length });
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
      return res.status(201).json({ success: true, message: 'Task added (offline)', data: item });
    }

    const result = await db.collection('maintenance').insertOne(item);
    item._id = result.insertedId;
    broadcast(hotelId, 'maintenance_upd', item, req.clientId);
    res.status(201).json({ success: true, message: 'Task added', data: item });
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
      return res.json({ success: true, message: 'Task updated (offline)', data: updated });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(status && { status }),
      ...(assigned !== undefined && { assigned }),
      ...(priority && { priority })
    };

    const result = await db.collection('maintenance').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const updated = await db.collection('maintenance').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'maintenance_upd', updated, req.clientId);
    res.json({ success: true, message: 'Task updated', data: updated });
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

    const result = await db.collection('maintenance').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    broadcast(hotelId, 'maintenance_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    console.error('Maintenance delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== REVIEWS CRUD ====================
app.get('/api/reviews', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const reviews = await db.collection('reviews').find({ hotelId }).sort({ date: -1 }).toArray();
    res.json({ success: true, data: reviews, count: reviews.length });
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
      return res.status(201).json({ success: true, message: 'Review added (offline)', data: review });
    }

    const result = await db.collection('reviews').insertOne(review);
    review._id = result.insertedId;
    broadcast(hotelId, 'review_new', review, req.clientId);
    res.status(201).json({ success: true, message: 'Review added', data: review });
  } catch (error) {
    console.error('Review create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== STAFF CRUD ====================
app.get('/api/staff', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const staff = await db.collection('staff').find({ hotelId }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: staff, count: staff.length });
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
      return res.status(201).json({ success: true, message: 'Staff added (offline)', data: s });
    }

    const result = await db.collection('staff').insertOne(s);
    s._id = result.insertedId;
    broadcast(hotelId, 'staff_upd', s, req.clientId);
    res.status(201).json({ success: true, message: 'Staff added', data: s });
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
      return res.json({ success: true, message: 'Staff updated (offline)', data: updated });
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

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Staff not found' });

    const updated = await db.collection('staff').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'staff_upd', updated, req.clientId);
    res.json({ success: true, message: 'Staff updated', data: updated });
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

    const result = await db.collection('staff').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Staff not found' });

    broadcast(hotelId, 'staff_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Staff removed' });
  } catch (error) {
    console.error('Staff delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== LOGS CRUD ====================
app.get('/api/logs', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const logs = await db.collection('logs').find({ hotelId }).sort({ timestamp: -1 }).limit(100).toArray();
    res.json({ success: true, data: logs, count: logs.length });
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
      return res.status(201).json({ success: true, message: 'Log added (offline)', data: log });
    }

    const result = await db.collection('logs').insertOne(log);
    log._id = result.insertedId;
    res.status(201).json({ success: true, message: 'Log added', data: log });
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

// ==================== CONFIG (alias for settings) ====================
app.get('/api/config', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const defaultConfig = { hotelId, name: 'Crown Plaza Hotel', currency: 'SAR', currencySymbol: '﷼', wifi: 'CrownPlaza@2024', airportPrice: 115, localPrice: 60 };

    if (!dbConnected) return res.json({ success: true, data: defaultConfig });

    const settings = await db.collection('settings').findOne({ hotelId });
    res.json({ success: true, data: settings || defaultConfig });
  } catch (error) {
    console.error('Config fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/config', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const config = req.body;

    if (!dbConnected) {
      const updated = { ...config, hotelId, updatedAt: new Date() };
      broadcast(hotelId, 'cfg_upd', updated, req.clientId);
      return res.json({ success: true, message: 'Config saved (offline)', data: updated });
    }

    const updateData = { ...config, hotelId, updatedAt: new Date() };
    await db.collection('settings').updateOne({ hotelId }, { $set: updateData }, { upsert: true });
    const updated = await db.collection('settings').findOne({ hotelId });
    broadcast(hotelId, 'cfg_upd', updated, req.clientId);
    res.json({ success: true, message: 'Config saved', data: updated });
  } catch (error) {
    console.error('Config save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ANNOUNCEMENTS CRUD ====================
app.get('/api/announcements', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const announcements = await db.collection('announcements').find({ hotelId }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: announcements, count: announcements.length });
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
        hotelId,
        category,
        title,
        message,
        isActive: isActive !== undefined ? isActive : true,
        _version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'announcement_upd', announcement, req.clientId);
      return res.status(201).json({ success: true, message: 'Announcement added (offline)', data: announcement });
    }

    const announcement = {
      hotelId,
      category,
      title,
      message,
      isActive: isActive !== undefined ? isActive : true,
      _version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = await db.collection('announcements').insertOne(announcement);
    announcement._id = result.insertedId;
    broadcast(hotelId, 'announcement_upd', announcement, req.clientId);
    res.status(201).json({ success: true, message: 'Announcement created', data: announcement });
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
        _id: id,
        hotelId,
        category,
        title,
        message,
        isActive,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'announcement_upd', updated, req.clientId);
      return res.json({ success: true, message: 'Announcement updated (offline)', data: updated });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(category && { category }),
      ...(title && { title }),
      ...(message && { message }),
      ...(isActive !== undefined && { isActive })
    };

    const result = await db.collection('announcements').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Announcement not found' });
    }

    const updated = await db.collection('announcements').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'announcement_upd', updated, req.clientId);
    res.json({ success: true, message: 'Announcement updated', data: updated });
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

    const result = await db.collection('announcements').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Announcement not found' });
    }

    broadcast(hotelId, 'announcement_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    console.error('Announcement delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== POLICIES CRUD ====================
app.get('/api/policies', async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected) return res.json({ success: true, data: [], count: 0 });
    const policies = await db.collection('policies').find({ hotelId }).toArray();
    res.json({ success: true, data: policies, count: policies.length });
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
        hotelId,
        type,
        content,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        _version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'policy_upd', policy, req.clientId);
      return res.status(201).json({ success: true, message: 'Policy added (offline)', data: policy });
    }

    const policy = {
      hotelId,
      type,
      content,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      _version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = await db.collection('policies').insertOne(policy);
    policy._id = result.insertedId;
    broadcast(hotelId, 'policy_upd', policy, req.clientId);
    res.status(201).json({ success: true, message: 'Policy created', data: policy });
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
        _id: id,
        hotelId,
        type,
        content,
        isEnabled,
        updatedAt: new Date().toISOString()
      };
      broadcast(hotelId, 'policy_upd', updated, req.clientId);
      return res.json({ success: true, message: 'Policy updated (offline)', data: updated });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
      ...(type && { type }),
      ...(content && { content }),
      ...(isEnabled !== undefined && { isEnabled })
    };

    const result = await db.collection('policies').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Policy not found' });
    }

    const updated = await db.collection('policies').findOne({ _id: new ObjectId(id) });
    broadcast(hotelId, 'policy_upd', updated, req.clientId);
    res.json({ success: true, message: 'Policy updated', data: updated });
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

    const result = await db.collection('policies').deleteOne({ _id: new ObjectId(id), hotelId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Policy not found' });
    }

    broadcast(hotelId, 'policy_upd', { _id: id, hotelId, deleted: true }, req.clientId);
    res.json({ success: true, message: 'Policy deleted' });
  } catch (error) {
    console.error('Policy delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    if (!dbConnected || !db) return res.status(503).json({ success: false, error: 'Database connecting...' });

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
        occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ✅ NEW: PAGE STATE PERSISTENCE ====================
// Stores last active page per user (for refresh stability)
app.post('/api/user/page-state', authMiddleware, async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { page, state } = req.body;
    const email = req.user?.email;

    if (!email) return res.status(400).json({ success: false, error: 'User not identified' });

    const key = `${hotelId}_${email}`;

    if (!dbConnected) {
      return res.json({ success: true, message: 'Page state saved (memory only)' });
    }

    await db.collection('sessions').updateOne(
      { email, hotelId },
      { $set: { lastPage: page, pageState: state, lastActivity: new Date() } },
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
        pageState: sessionDoc?.pageState || null
      }
    });
  } catch (error) {
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

// ✅ IMPORTANT: API 404 before wildcard
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ==================== SERVER START ====================
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
  console.log(`📍 Page stability: /api/user/page-state`);
  console.log(`🔔 Idle session logout: /api/auth/config, /api/auth/ping`);
  console.log(`📜 Policies API: /api/policies`);
  console.log(`📢 Announcements API: /api/announcements`);
  console.log(`⚙️ Config API: /api/config`);
  console.log(`\n💡 NEW .env variables:`);
  console.log(`   IDLE_TIMEOUT_MS=1800000        (default: 30 min)`);
  console.log(`   TOKEN_EXPIRY=7d                 (default: 7 days)`);
  console.log(`   TOKEN_REFRESH_THRESHOLD_MS=3600000 (default: 1hr)`);
  console.log(`   SESSION_MAX_AGE=604800000       (default: 7 days)\n`);
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

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
  if (err.message.includes('EADDRINUSE')) process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});