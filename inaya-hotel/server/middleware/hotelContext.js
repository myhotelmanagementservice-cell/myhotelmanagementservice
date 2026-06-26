// server/middleware/hotelContext.js
// Hotel Context Middleware - Extracts, validates, and attaches hotel context to requests
// Compatible with multi-tenant architecture and real-time sync
// Features: Multi-source extraction, Validation, Caching, Logging

const { getDB, isConnected } = require('../config/db');

// ============================================================
// HOTEL ID CACHE (5-min TTL to reduce DB hits)
// ============================================================
const hotelCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached hotel data
 * @param {string} hotelId - Hotel ID
 * @returns {Object|null} - Cached hotel data or null
 */
function getCachedHotel(hotelId) {
  const cached = hotelCache.get(hotelId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  hotelCache.delete(hotelId);
  return null;
}

/**
 * Set hotel data in cache
 * @param {string} hotelId - Hotel ID
 * @param {Object} data - Hotel data to cache
 */
function setCachedHotel(hotelId, data) {
  hotelCache.set(hotelId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate hotel cache
 * @param {string} hotelId - Hotel ID
 */
function invalidateHotelCache(hotelId) {
  hotelCache.delete(hotelId);
}

// ============================================================
// HOTEL ID EXTRACTION
// ============================================================

/**
 * Extract hotel ID from multiple sources
 * Priority: Header -> Query -> Session -> Body -> Environment -> Default
 * @param {Object} req - Express request object
 * @returns {string} - Hotel ID
 */
const getHotelId = (req) => {
  let rawId = null;

  // 1️⃣ Header (highest priority - most reliable)
  if (req.headers['x-hotel-id']) {
    rawId = req.headers['x-hotel-id'];
  }
  // 2️⃣ Query parameter
  else if (req.query.hotelId || req.query.hotel) {
    rawId = req.query.hotelId || req.query.hotel;
  }
  // 3️⃣ Session (for authenticated users)
  else if (req.session && req.session.hotelId) {
    rawId = req.session.hotelId;
  }
  // 4️⃣ Request body (for POST requests)
  else if (req.body && req.body.hotelId) {
    rawId = req.body.hotelId;
  }
  // 5️⃣ Environment variable
  else if (process.env.DEFAULT_HOTEL_ID) {
    rawId = process.env.DEFAULT_HOTEL_ID;
  }
  // 6️⃣ Development fallback
  else {
    rawId = 'CPH001';
  }

  // Normalize: trim whitespace & uppercase for consistent DB routing
  return String(rawId).trim().toUpperCase();
};

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate hotel ID format
 * Secure format: 3-50 chars, alphanumeric, hyphens, underscores only
 * @param {string} hotelId - Hotel ID to validate
 * @returns {boolean} - True if valid
 */
const validateHotelId = (hotelId) => {
  if (!hotelId || typeof hotelId !== 'string') {
    return false;
  }
  return /^[A-Z0-9_-]{3,50}$/.test(hotelId);
};

/**
 * Check if hotel exists in database
 * Uses cache to reduce DB hits
 * @param {string} hotelId - Hotel ID
 * @returns {Promise<Object|null>} - Hotel data or null
 */
async function checkHotelExists(hotelId) {
  // Check cache first
  const cached = getCachedHotel(hotelId);
  if (cached) {
    return cached;
  }

  // Check database
  if (!isConnected()) {
    return null;
  }

  const db = getDB();
  if (!db) {
    return null;
  }

  try {
    const hotel = await db.collection('tenants').findOne({ hotelId });

    if (hotel) {
      // Cache the result
      setCachedHotel(hotelId, hotel);
    }

    return hotel;
  } catch (error) {
    console.error('❌ Hotel existence check error:', error.message);
    return null;
  }
}

// ============================================================
// MAIN MIDDLEWARE
// ============================================================

/**
 * Hotel context middleware
 * Extracts hotel ID, validates it, and attaches to request
 * Optionally validates hotel existence in database
 */
const hotelContext = async (req, res, next) => {
  try {
    const startTime = Date.now();

    // 1️⃣ Extract hotel ID
    const hotelId = getHotelId(req);

    // 2️⃣ Validate format
    if (!validateHotelId(hotelId)) {
      console.warn(`⚠️ Invalid hotel ID format: ${hotelId}`);
      return res.status(400).json({
        success: false,
        error: 'INVALID_HOTEL_ID',
        message: 'Hotel ID must be 3-50 alphanumeric characters, hyphens, or underscores',
        provided: hotelId
      });
    }

    // 3️⃣ Attach to request
    req.hotelId = hotelId;

    // 4️⃣ Set response header (for debugging)
    res.setHeader('X-Hotel-Id', hotelId);

    // 5️⃣ Optional: Validate hotel exists (uncomment for strict validation)
    // const hotel = await checkHotelExists(hotelId);
    // if (!hotel) {
    //   console.warn(`⚠️ Hotel not found: ${hotelId}`);
    //   return res.status(404).json({
    //     success: false,
    //     error: 'HOTEL_NOT_FOUND',
    //     message: 'Hotel does not exist',
    //     hotelId
    //   });
    // }
    // 
    // // Attach hotel info to request (for use in controllers)
    // req.hotelInfo = {
    //   hotelId: hotel.hotelId,
    //   hotelName: hotel.hotelName,
    //   currency: hotel.currency,
    //   currencySymbol: hotel.currencySymbol,
    //   language: hotel.language,
    //   active: hotel.active
    // };

    // 6️⃣ Logging (optional - remove in production if verbose)
    const duration = Date.now() - startTime;
    if (process.env.NODE_ENV === 'development') {
      console.log(`🏨 Context: ${req.method} ${req.path} | Hotel: ${hotelId} | ${duration}ms`);
    }

    next();

  } catch (error) {
    console.error('❌ Hotel context middleware error:', error.message);

    // Don't block request on error - use fallback
    req.hotelId = 'CPH001';
    res.setHeader('X-Hotel-Id', req.hotelId);

    next();
  }
};

// ============================================================
// STRICT HOTEL CONTEXT (Validates hotel exists)
// Use this for critical operations like payments, data export, etc.
// ============================================================
const strictHotelContext = async (req, res, next) => {
  try {
    const hotelId = getHotelId(req);

    // Validate format
    if (!validateHotelId(hotelId)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_HOTEL_ID',
        message: 'Hotel ID must be 3-50 alphanumeric characters, hyphens, or underscores',
        provided: hotelId
      });
    }

    // Check if hotel exists
    const hotel = await checkHotelExists(hotelId);

    if (!hotel) {
      return res.status(404).json({
        success: false,
        error: 'HOTEL_NOT_FOUND',
        message: 'Hotel does not exist',
        hotelId
      });
    }

    // Check if hotel is active
    if (!hotel.active) {
      return res.status(403).json({
        success: false,
        error: 'HOTEL_INACTIVE',
        message: 'Hotel account is inactive',
        hotelId
      });
    }

    // Attach to request
    req.hotelId = hotelId;
    req.hotelInfo = {
      hotelId: hotel.hotelId,
      hotelName: hotel.hotelName,
      currency: hotel.currency,
      currencySymbol: hotel.currencySymbol,
      language: hotel.language,
      active: hotel.active
    };

    res.setHeader('X-Hotel-Id', hotelId);

    next();

  } catch (error) {
    console.error('❌ Strict hotel context error:', error.message);
    res.status(500).json({
      success: false,
      error: 'HOTEL_CONTEXT_FAILED',
      message: 'Failed to validate hotel context'
    });
  }
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Main middleware
  hotelContext,
  strictHotelContext,

  // Helper functions
  getHotelId,
  validateHotelId,
  checkHotelExists,

  // Cache management
  getCachedHotel,
  setCachedHotel,
  invalidateHotelCache
};

// Default export for backward compatibility
module.exports.default = hotelContext;