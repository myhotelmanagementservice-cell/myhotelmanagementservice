// server/middleware/multitenant.js - Multi-Tenant Isolation Middleware
const { ObjectId } = require('mongodb');

/**
 * Extract hotelId from various sources in priority order:
 * 1. Request header: x-hotel-id
 * 2. Query parameter: ?hotelId= or ?hotel=
 * 3. Session: req.session.hotelId
 * 4. JWT token: req.user.hotelId
 * 5. Default: 'default' (for demo mode)
 */
const extractHotelId = (req) => {
  // Priority 1: Header
  if (req.headers['x-hotel-id']) {
    return req.headers['x-hotel-id'];
  }

  // Priority 2: Query params
  if (req.query.hotelId) {
    return req.query.hotelId;
  }
  if (req.query.hotel) {
    return req.query.hotel;
  }

  // Priority 3: Session
  if (req.session?.hotelId) {
    return req.session.hotelId;
  }

  // Priority 4: JWT token (if auth middleware ran first)
  if (req.user?.hotelId) {
    return req.user.hotelId;
  }

  // Fallback: default hotel (for demo/development)
  return 'default';
};

/**
 * Validate hotelId format (alphanumeric, hyphens, underscores only)
 */
const isValidHotelId = (hotelId) => {
  if (!hotelId || typeof hotelId !== 'string') return false;
  // Allow: letters, numbers, hyphens, underscores; 3-50 chars
  return /^[a-zA-Z0-9_-]{3,50}$/.test(hotelId);
};

/**
 * Main multitenant middleware
 * - Extracts and validates hotelId
 * - Checks tenant exists and is active
 * - Checks subscription expiry
 * - Injects hotelId into req for downstream use
 */
const multitenantMiddleware = async (req, res, next) => {
  try {
    const hotelId = extractHotelId(req);

    // Validate hotelId format
    if (!isValidHotelId(hotelId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid hotel ID format',
        message: 'Hotel ID must be 3-50 alphanumeric characters'
      });
    }

    // Attach hotelId to request for use in routes
    req.hotelId = hotelId;

    // Skip tenant validation for 'default' hotel (demo mode)
    if (hotelId === 'default') {
      return next();
    }

    // Skip validation for public endpoints
    const publicPaths = ['/api/health', '/api/auth/login', '/api/auth/register'];
    if (publicPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Get database connection from app
    const db = req.app.get('db');
    if (!db) {
      // If DB not connected, allow request but log warning
      console.warn(`⚠️ Database not connected, skipping tenant validation for: ${hotelId}`);
      return next();
    }

    // Fetch tenant record
    const tenant = await db.collection('tenants').findOne({ hotelId });

    // If tenant doesn't exist, auto-create for first-time setup
    if (!tenant) {
      // Only auto-create for POST/PUT requests to tenant registration endpoint
      if (req.path === '/api/super/tenants/register' && req.method === 'POST') {
        return next(); // Let the registration endpoint handle creation
      }

      // For other endpoints, return helpful error
      return res.status(404).json({
        success: false,
        error: 'Hotel not found',
        message: `No hotel registered with ID: ${hotelId}`,
        action: 'Please contact your administrator to register this hotel'
      });
    }

    // Check if hotel is active
    if (!tenant.active) {
      return res.status(403).json({
        success: false,
        error: 'Hotel account is inactive',
        message: 'This hotel has been deactivated',
        action: 'Please contact support to reactivate your account'
      });
    }

    // Check subscription expiry (if applicable)
    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'Subscription expired',
        expiryDate: tenant.subscriptionExpiry,
        message: `Your subscription expired on ${new Date(tenant.subscriptionExpiry).toLocaleDateString()}`,
        action: 'Please renew your subscription to continue using the service'
      });
    }

    // Inject tenant config into request for convenience
    req.tenant = {
      hotelId: tenant.hotelId,
      hotelName: tenant.hotelName,
      currency: tenant.currency,
      currencySymbol: tenant.currencySymbol,
      language: tenant.language,
      country: tenant.country,
      timezone: tenant.timezone,
      theme: tenant.theme
    };

    // Log tenant access for audit (async, don't block request)
    if (req.path !== '/api/logs' && !req.path.includes('/export')) {
      db.collection('logs').insertOne({
        hotelId,
        user: req.user?.email || req.session?.adminEmail || 'system',
        action: `${req.method} ${req.path}`,
        ip: req.ip,
        timestamp: new Date()
      }).catch(err => console.warn('Log insert failed:', err.message));
    }

    next();

  } catch (error) {
    console.error('Multitenant middleware error:', error.message);

    // Don't crash the server on middleware error
    if (process.env.NODE_ENV === 'development') {
      return res.status(500).json({
        success: false,
        error: 'Tenant validation error',
        message: error.message,
        stack: error.stack
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Unable to validate tenant'
    });
  }
};

/**
 * Helper: Scope a MongoDB query to current hotel
 * Usage: const query = scopeQuery({ status: 'open' }, req.hotelId);
 */
const scopeQuery = (baseQuery, hotelId) => {
  return { ...baseQuery, hotelId };
};

/**
 * Helper: Ensure user can only access their hotel's data
 * Usage in route: const rooms = await db.collection('rooms').find(scopeQuery({}, req.hotelId)).toArray();
 */
const ensureTenantScope = (collection, hotelId) => {
  return {
    find: (query = {}) => collection.find(scopeQuery(query, hotelId)),
    findOne: (query = {}) => collection.findOne(scopeQuery(query, hotelId)),
    insertOne: (doc) => collection.insertOne({ ...doc, hotelId }),
    updateOne: (filter, update) => 
      collection.updateOne(scopeQuery(filter, hotelId), update),
    deleteOne: (filter) => 
      collection.deleteOne(scopeQuery(filter, hotelId)),
    countDocuments: (query = {}) => 
      collection.countDocuments(scopeQuery(query, hotelId))
  };
};

module.exports = {
  multitenantMiddleware,
  extractHotelId,
  isValidHotelId,
  scopeQuery,
  ensureTenantScope
};
