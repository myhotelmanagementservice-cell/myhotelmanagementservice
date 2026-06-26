// server/middleware/subscription.js
// Subscription & Tenant Validation Middleware for Multi-Tenant Hotel SaaS
// Compatible with index.html (19 admin pages + 9 guest pages)
// Features: Caching, Graceful Degradation, Detailed Logging

const { getDB, isConnected } = require('../config/db');

// ============================================================
// SUBSCRIPTION CACHE (5-min TTL to avoid DB hits on every request)
// ============================================================
const subscriptionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached subscription data
 * @param {string} hotelId - Hotel ID
 * @returns {Object|null} - Cached tenant data or null
 */
function getCachedSubscription(hotelId) {
  const cached = subscriptionCache.get(hotelId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  // Expired - remove from cache
  subscriptionCache.delete(hotelId);
  return null;
}

/**
 * Set subscription data in cache
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Tenant data to cache
 */
function setCachedSubscription(hotelId, data) {
  subscriptionCache.set(hotelId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate subscription cache for a specific hotel
 * @param {string} hotelId - Hotel ID
 */
function invalidateSubscriptionCache(hotelId) {
  subscriptionCache.delete(hotelId);
  console.log(`🗑️ Subscription cache invalidated for: ${hotelId}`);
}

/**
 * Clear entire subscription cache
 */
function clearSubscriptionCache() {
  subscriptionCache.clear();
  console.log('🗑️ Entire subscription cache cleared');
}

// ============================================================
// SUBSCRIPTION CHECK MIDDLEWARE
// ============================================================

/**
 * Main subscription validation middleware
 * Checks: Hotel exists → Hotel active → Subscription not expired
 * Uses cache to reduce DB load
 */
const checkSubscription = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;

    // ✅ Skip validation for default hotel (development/fallback)
    if (!hotelId || hotelId === 'default') {
      return next();
    }

    // ✅ Validate hotelId format (basic security)
    if (!/^[A-Z0-9\-]+$/i.test(hotelId)) {
      console.warn(`⚠️ Invalid hotelId format: ${hotelId}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid hotel ID format',
        code: 'INVALID_HOTEL_ID'
      });
    }

    // ✅ Graceful degradation: if DB not connected, allow request
    if (!isConnected()) {
      console.warn(`⚠️ DB not connected, allowing request for: ${hotelId}`);
      return next();
    }

    const db = getDB();
    if (!db) {
      console.warn(`⚠️ DB instance not available, allowing request for: ${hotelId}`);
      return next();
    }

    // ✅ CHECK CACHE FIRST (reduces DB load)
    const cachedTenant = getCachedSubscription(hotelId);
    if (cachedTenant) {
      // Validate cached data
      if (!cachedTenant.active) {
        console.log(`❌ Cached: Hotel ${hotelId} is inactive`);
        return res.status(403).json({
          success: false,
          error: 'Hotel account is inactive',
          code: 'HOTEL_INACTIVE',
          hotelId
        });
      }

      if (cachedTenant.subscriptionExpiry && new Date(cachedTenant.subscriptionExpiry) < new Date()) {
        console.log(`❌ Cached: Hotel ${hotelId} subscription expired`);
        return res.status(403).json({
          success: false,
          error: 'Subscription expired',
          code: 'SUBSCRIPTION_EXPIRED',
          expiryDate: cachedTenant.subscriptionExpiry,
          action: 'Please renew your subscription',
          hotelId
        });
      }

      // ✅ Cache valid - proceed
      return next();
    }

    // ✅ CACHE MISS - Fetch from DB
    const tenant = await db.collection('tenants').findOne({ hotelId });

    // ✅ If tenant not found, allow (might be new hotel or default)
    if (!tenant) {
      console.log(`ℹ️ Tenant not found in DB: ${hotelId} - allowing request`);
      return next();
    }

    // ✅ Cache the tenant data
    setCachedSubscription(hotelId, tenant);

    // ✅ Check if hotel is active
    if (!tenant.active) {
      console.log(`❌ Hotel ${hotelId} is inactive`);
      return res.status(403).json({
        success: false,
        error: 'Hotel account is inactive',
        code: 'HOTEL_INACTIVE',
        hotelId
      });
    }

    // ✅ Check subscription expiry
    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      console.log(`❌ Hotel ${hotelId} subscription expired on ${tenant.subscriptionExpiry}`);
      return res.status(403).json({
        success: false,
        error: 'Subscription expired',
        code: 'SUBSCRIPTION_EXPIRED',
        expiryDate: tenant.subscriptionExpiry,
        action: 'Please renew your subscription',
        hotelId
      });
    }

    // ✅ All checks passed
    // console.log(`✅ Subscription valid for hotel: ${hotelId}`);
    next();

  } catch (error) {
    // ✅ Graceful error handling - don't block requests on errors
    console.error('❌ Subscription check error:', error.message);

    // In production, you might want to log this to monitoring service
    // For now, allow request to proceed (fail-open for availability)
    next();
  }
};

// ============================================================
// STRICT SUBSCRIPTION CHECK (No graceful degradation)
// Use this for critical operations like payments, data export, etc.
// ============================================================
const strictSubscriptionCheck = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;

    if (!hotelId || hotelId === 'default') {
      return next();
    }

    if (!isConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Database unavailable',
        code: 'DB_UNAVAILABLE'
      });
    }

    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database not initialized',
        code: 'DB_NOT_INITIALIZED'
      });
    }

    const tenant = await db.collection('tenants').findOne({ hotelId });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Hotel not found',
        code: 'HOTEL_NOT_FOUND',
        hotelId
      });
    }

    if (!tenant.active) {
      return res.status(403).json({
        success: false,
        error: 'Hotel account is inactive',
        code: 'HOTEL_INACTIVE',
        hotelId
      });
    }

    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'Subscription expired',
        code: 'SUBSCRIPTION_EXPIRED',
        expiryDate: tenant.subscriptionExpiry,
        action: 'Please renew your subscription',
        hotelId
      });
    }

    next();

  } catch (error) {
    console.error('❌ Strict subscription check error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Subscription validation failed',
      code: 'SUBSCRIPTION_CHECK_FAILED'
    });
  }
};

// ============================================================
// TENANT INFO MIDDLEWARE (Attaches tenant info to request)
// ============================================================
const attachTenantInfo = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;

    if (!hotelId || hotelId === 'default') {
      return next();
    }

    // Check cache first
    let tenant = getCachedSubscription(hotelId);

    if (!tenant && isConnected()) {
      const db = getDB();
      if (db) {
        tenant = await db.collection('tenants').findOne({ hotelId });
        if (tenant) {
          setCachedSubscription(hotelId, tenant);
        }
      }
    }

    // Attach tenant info to request (for use in controllers)
    if (tenant) {
      req.tenant = {
        hotelId: tenant.hotelId,
        hotelName: tenant.hotelName,
        currency: tenant.currency,
        currencySymbol: tenant.currencySymbol,
        language: tenant.language,
        subscriptionType: tenant.subscriptionType,
        subscriptionExpiry: tenant.subscriptionExpiry,
        active: tenant.active
      };
    }

    next();
  } catch (error) {
    console.error('❌ Attach tenant info error:', error.message);
    next(); // Don't block request
  }
};

// ============================================================
// SUBSCRIPTION WARNING MIDDLEWARE
// Adds warning header if subscription is about to expire
// ============================================================
const subscriptionWarning = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;

    if (!hotelId || hotelId === 'default') {
      return next();
    }

    const tenant = getCachedSubscription(hotelId);
    if (!tenant || !tenant.subscriptionExpiry) {
      return next();
    }

    const expiryDate = new Date(tenant.subscriptionExpiry);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    // Add warning header if expiring within 7 days
    if (daysUntilExpiry > 0 && daysUntilExpiry <= 7) {
      res.setHeader('X-Subscription-Warning', `Expiring in ${daysUntilExpiry} days`);
      res.setHeader('X-Subscription-Expiry', expiryDate.toISOString());
    }

    next();
  } catch (error) {
    console.error('❌ Subscription warning error:', error.message);
    next();
  }
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Main middleware
  checkSubscription,
  strictSubscriptionCheck,

  // Helper middleware
  attachTenantInfo,
  subscriptionWarning,

  // Cache management
  invalidateSubscriptionCache,
  clearSubscriptionCache,
  getCachedSubscription,
  setCachedSubscription
};