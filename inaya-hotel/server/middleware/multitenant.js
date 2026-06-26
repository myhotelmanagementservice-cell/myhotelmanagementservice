// server/middleware/multitenant.js
// Multi-Tenant Isolation Middleware - Production Ready
// Features: Caching, Graceful Degradation, Error Codes, Performance Optimized
// Compatible with index.html (19 admin pages + 9 guest pages)

// ============================================================
// TENANT CACHE (5-min TTL to reduce DB hits)
// ============================================================
const tenantCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached tenant data
 */
function getCachedTenant(hotelId) {
  const cached = tenantCache.get(hotelId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  tenantCache.delete(hotelId);
  return null;
}

/**
 * Set tenant data in cache
 */
function setCachedTenant(hotelId, data) {
  tenantCache.set(hotelId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate tenant cache
 */
function invalidateTenantCache(hotelId) {
  tenantCache.delete(hotelId);
}

/**
 * Clear entire tenant cache
 */
function clearTenantCache() {
  tenantCache.clear();
}

// ============================================================
// PUBLIC PATHS CONFIGURATION
// ============================================================
const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/super/tenants/register',
  '/api/super/admins/register',
  '/socket.io'
];

/**
 * Check if path is public (no tenant validation needed)
 */
function isPublicPath(path) {
  return PUBLIC_PATHS.some(publicPath => path.startsWith(publicPath));
}

// ============================================================
// HOTEL ID EXTRACTION
// ============================================================

/**
 * Extract hotelId from various sources in priority order:
 * 1. Request header: x-hotel-id (most reliable)
 * 2. Query parameter: ?hotelId= or ?hotel=
 * 3. Session: req.session.hotelId
 * 4. JWT token: req.user.hotelId
 * 5. Request body: req.body.hotelId (for POST requests)
 * 6. Environment: DEFAULT_HOTEL_ID
 * 7. Default: 'default' (for demo mode)
 */
const extractHotelId = (req) => {
  let hotelId = null;

  // Priority 1: Header (most reliable)
  if (req.headers['x-hotel-id']) {
    hotelId = req.headers['x-hotel-id'];
  }
  // Priority 2: Query params
  else if (req.query.hotelId) {
    hotelId = req.query.hotelId;
  }
  else if (req.query.hotel) {
    hotelId = req.query.hotel;
  }
  // Priority 3: Session
  else if (req.session?.hotelId) {
    hotelId = req.session.hotelId;
  }
  // Priority 4: JWT token (if auth middleware ran first)
  else if (req.user?.hotelId) {
    hotelId = req.user.hotelId;
  }
  // Priority 5: Request body (for POST requests)
  else if (req.body?.hotelId) {
    hotelId = req.body.hotelId;
  }
  // Priority 6: Environment variable
  else if (process.env.DEFAULT_HOTEL_ID) {
    hotelId = process.env.DEFAULT_HOTEL_ID;
  }
  // Fallback: default hotel (for demo/development)
  else {
    hotelId = 'default';
  }

  // Normalize: trim & uppercase
  return String(hotelId).trim().toUpperCase();
};

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate hotelId format (alphanumeric, hyphens, underscores only)
 * Secure format: 3-50 chars
 */
const isValidHotelId = (hotelId) => {
  if (!hotelId || typeof hotelId !== 'string') return false;
  return /^[A-Z0-9_-]{3,50}$/.test(hotelId);
};

// ============================================================
// MAIN MULTITENANT MIDDLEWARE
// ============================================================

/**
 * Main multitenant middleware
 * - Extracts and validates hotelId
 * - Checks tenant exists and is active (with caching)
 * - Checks subscription expiry
 * - Injects hotelId and tenant info into req
 * - Graceful degradation on errors
 */
const multitenantMiddleware = async (req, res, next) => {
  const startTime = Date.now();

  try {
    // 1️⃣ Extract hotelId
    const hotelId = extractHotelId(req);

    // 2️⃣ Validate hotelId format
    if (!isValidHotelId(hotelId)) {
      console.warn(`⚠️ Invalid hotel ID format: ${hotelId}`);
      return res.status(400).json({
        success: false,
        error: 'INVALID_HOTEL_ID',
        message: 'Hotel ID must be 3-50 alphanumeric characters, hyphens, or underscores',
        provided: hotelId
      });
    }

    // 3️⃣ Attach hotelId to request
    req.hotelId = hotelId;
    res.setHeader('X-Hotel-Id', hotelId);

    // 4️⃣ Skip validation for 'default' hotel (demo mode)
    if (hotelId === 'DEFAULT' || hotelId === 'default') {
      return next();
    }

    // 5️⃣ Skip validation for public endpoints
    if (isPublicPath(req.path)) {
      return next();
    }

    // 6️⃣ Get database connection
    const db = req.app.get('db');
    if (!db) {
      // Graceful degradation: allow request but log warning
      console.warn(`⚠️ Database not connected, skipping tenant validation for: ${hotelId}`);
      return next();
    }

    // 7️⃣ CHECK CACHE FIRST (performance optimization)
    let tenant = getCachedTenant(hotelId);

    if (tenant) {
      // Cache hit - validate cached data
      if (!tenant.active) {
        return res.status(403).json({
          success: false,
          error: 'HOTEL_INACTIVE',
          message: 'This hotel has been deactivated',
          action: 'Please contact support to reactivate your account',
          hotelId
        });
      }

      if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
        return res.status(403).json({
          success: false,
          error: 'SUBSCRIPTION_EXPIRED',
          message: `Your subscription expired on ${new Date(tenant.subscriptionExpiry).toLocaleDateString()}`,
          expiryDate: tenant.subscriptionExpiry,
          action: 'Please renew your subscription to continue using the service',
          hotelId
        });
      }

      // Cache valid - inject tenant info and proceed
      req.tenant = {
        hotelId: tenant.hotelId,
        hotelName: tenant.hotelName,
        currency: tenant.currency,
        currencySymbol: tenant.currencySymbol,
        language: tenant.language,
        country: tenant.country,
        timezone: tenant.timezone,
        theme: tenant.theme,
        subscriptionType: tenant.subscriptionType
      };

      // Log performance
      if (process.env.NODE_ENV === 'development') {
        const duration = Date.now() - startTime;
        console.log(`🏨 [CACHE] ${req.method} ${req.path} | Hotel: ${hotelId} | ${duration}ms`);
      }

      return next();
    }

    // 8️⃣ CACHE MISS - Fetch from database
    tenant = await db.collection('tenants').findOne({ hotelId });

    // 9️⃣ Handle tenant not found
    if (!tenant) {
      // Check if this is a registration request
      if (req.path === '/api/super/tenants/register' && req.method === 'POST') {
        return next(); // Let registration endpoint handle creation
      }

      return res.status(404).json({
        success: false,
        error: 'HOTEL_NOT_FOUND',
        message: `No hotel registered with ID: ${hotelId}`,
        action: 'Please contact your administrator to register this hotel',
        hotelId
      });
    }

    // 🔟 Cache the tenant data
    setCachedTenant(hotelId, tenant);

    // 1️⃣1️⃣ Check if hotel is active
    if (!tenant.active) {
      return res.status(403).json({
        success: false,
        error: 'HOTEL_INACTIVE',
        message: 'This hotel has been deactivated',
        action: 'Please contact support to reactivate your account',
        hotelId
      });
    }

    // 1️⃣2️⃣ Check subscription expiry
    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'SUBSCRIPTION_EXPIRED',
        message: `Your subscription expired on ${new Date(tenant.subscriptionExpiry).toLocaleDateString()}`,
        expiryDate: tenant.subscriptionExpiry,
        action: 'Please renew your subscription to continue using the service',
        hotelId
      });
    }

    // 1️⃣3️⃣ Inject tenant config into request
    req.tenant = {
      hotelId: tenant.hotelId,
      hotelName: tenant.hotelName,
      currency: tenant.currency,
      currencySymbol: tenant.currencySymbol,
      language: tenant.language,
      country: tenant.country,
      timezone: tenant.timezone,
      theme: tenant.theme,
      subscriptionType: tenant.subscriptionType,
      subscriptionExpiry: tenant.subscriptionExpiry,
      active: tenant.active
    };

    // 1️⃣4️⃣ Async logging (non-blocking, only for non-log endpoints)
    if (req.path !== '/api/logs' && !req.path.includes('/export')) {
      // Fire and forget - don't wait for log insert
      db.collection('logs').insertOne({
        hotelId,
        user: req.user?.email || req.session?.adminEmail || 'system',
        action: `${req.method} ${req.path}`,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date()
      }).catch(err => {
        // Silent fail - don't crash on log errors
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ Log insert failed:', err.message);
        }
      });
    }

    // 1️⃣5️⃣ Log performance (development only)
    if (process.env.NODE_ENV === 'development') {
      const duration = Date.now() - startTime;
      console.log(`🏨 [DB] ${req.method} ${req.path} | Hotel: ${hotelId} | ${duration}ms`);
    }

    next();

  } catch (error) {
    console.error('❌ Multitenant middleware error:', error.message);

    // Graceful degradation: don't crash the server
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).json({
        success: false,
        error: 'TENANT_VALIDATION_ERROR',
        message: error.message,
        stack: error.stack
      });
    }

    // Production: generic error message
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Unable to validate tenant'
    });
  }
};

// ============================================================
// STRICT MULTITENANT MIDDLEWARE (No graceful degradation)
// Use for critical operations: payments, data export, etc.
// ============================================================
const strictMultitenantMiddleware = async (req, res, next) => {
  try {
    const hotelId = extractHotelId(req);

    if (!isValidHotelId(hotelId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_HOTEL_ID',
        message: 'Hotel ID must be 3-50 alphanumeric characters',
        provided: hotelId
      });
    }

    req.hotelId = hotelId;

    if (hotelId === 'DEFAULT' || hotelId === 'default') {
      return next();
    }

    const db = req.app.get('db');
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'DB_UNAVAILABLE',
        message: 'Database not connected'
      });
    }

    // Check cache first
    let tenant = getCachedTenant(hotelId);

    if (!tenant) {
      tenant = await db.collection('tenants').findOne({ hotelId });
      if (tenant) {
        setCachedTenant(hotelId, tenant);
      }
    }

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'HOTEL_NOT_FOUND',
        message: `Hotel not found: ${hotelId}`,
        hotelId
      });
    }

    if (!tenant.active) {
      return res.status(403).json({
        success: false,
        error: 'HOTEL_INACTIVE',
        message: 'Hotel account is inactive',
        hotelId
      });
    }

    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'SUBSCRIPTION_EXPIRED',
        message: 'Subscription expired',
        expiryDate: tenant.subscriptionExpiry,
        hotelId
      });
    }

    req.tenant = {
      hotelId: tenant.hotelId,
      hotelName: tenant.hotelName,
      currency: tenant.currency,
      currencySymbol: tenant.currencySymbol,
      language: tenant.language,
      country: tenant.country,
      timezone: tenant.timezone,
      theme: tenant.theme,
      subscriptionType: tenant.subscriptionType
    };

    res.setHeader('X-Hotel-Id', hotelId);
    next();

  } catch (error) {
    console.error('❌ Strict multitenant error:', error.message);
    res.status(500).json({
      success: false,
      error: 'TENANT_VALIDATION_FAILED',
      message: 'Tenant validation failed'
    });
  }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Helper: Scope a MongoDB query to current hotel
 * Usage: const query = scopeQuery({ status: 'open' }, req.hotelId);
 */
const scopeQuery = (baseQuery, hotelId) => {
  return { ...baseQuery, hotelId };
};

/**
 * Helper: Ensure user can only access their hotel's data
 * Usage: const scopedRooms = ensureTenantScope(db.collection('rooms'), req.hotelId);
 *        const rooms = await scopedRooms.find({ status: 'Vacant' }).toArray();
 */
const ensureTenantScope = (collection, hotelId) => {
  return {
    find: (query = {}) => collection.find(scopeQuery(query, hotelId)),
    findOne: (query = {}) => collection.findOne(scopeQuery(query, hotelId)),
    insertOne: (doc) => collection.insertOne({ ...doc, hotelId }),
    updateOne: (filter, update) => 
      collection.updateOne(scopeQuery(filter, hotelId), update),
    updateMany: (filter, update) => 
      collection.updateMany(scopeQuery(filter, hotelId), update),
    deleteOne: (filter) => 
      collection.deleteOne(scopeQuery(filter, hotelId)),
    deleteMany: (filter) => 
      collection.deleteMany(scopeQuery(filter, hotelId)),
    countDocuments: (query = {}) => 
      collection.countDocuments(scopeQuery(query, hotelId)),
    aggregate: (pipeline) => 
      collection.aggregate([{ $match: { hotelId } }, ...pipeline])
  };
};

/**
 * Helper: Add hotelId to document before insert
 */
const addHotelId = (doc, hotelId) => {
  return { ...doc, hotelId };
};

/**
 * Helper: Validate that document belongs to current hotel
 */
const validateOwnership = (doc, hotelId) => {
  return doc && doc.hotelId === hotelId;
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Main middleware
  multitenantMiddleware,
  strictMultitenantMiddleware,

  // Helper functions
  extractHotelId,
  isValidHotelId,
  scopeQuery,
  ensureTenantScope,
  addHotelId,
  validateOwnership,

  // Cache management
  getCachedTenant,
  setCachedTenant,
  invalidateTenantCache,
  clearTenantCache,

  // Configuration
  isPublicPath,
  PUBLIC_PATHS
};