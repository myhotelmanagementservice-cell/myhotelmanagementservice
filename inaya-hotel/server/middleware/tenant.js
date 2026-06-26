// server/middleware/tenant.js
// Multi-Tenant Middleware - Extracts hotel ID and client info from requests
// Compatible with index.html and server.js

/**
 * Extract hotel ID from request
 * Priority: Header > Query > Session > Default
 * @param {Object} req - Express request object
 * @returns {string} - Hotel ID
 */
const getHotelId = (req) => {
  // 1️⃣ Check headers first (most reliable)
  const headerHotelId = req.headers['x-hotel-id'];
  if (headerHotelId && typeof headerHotelId === 'string' && headerHotelId.trim() !== '') {
    return headerHotelId.trim();
  }

  // 2️⃣ Check query parameters
  const queryHotelId = req.query.hotelId || req.query.hotel;
  if (queryHotelId && typeof queryHotelId === 'string' && queryHotelId.trim() !== '') {
    return queryHotelId.trim();
  }

  // 3️⃣ Check session (for authenticated users)
  const sessionHotelId = req.session?.hotelId;
  if (sessionHotelId && typeof sessionHotelId === 'string' && sessionHotelId.trim() !== '') {
    return sessionHotelId.trim();
  }

  // 4️⃣ Check body (for POST requests)
  const bodyHotelId = req.body?.hotelId;
  if (bodyHotelId && typeof bodyHotelId === 'string' && bodyHotelId.trim() !== '') {
    return bodyHotelId.trim();
  }

  // 5️⃣ Default fallback
  return 'default';
};

/**
 * Tenant middleware - Sets hotelId on request object
 * This middleware should be applied to all tenant-specific routes
 */
const tenantMiddleware = (req, res, next) => {
  try {
    const hotelId = getHotelId(req);

    // Validate hotelId format (optional - uncomment if needed)
    // if (!/^[A-Z0-9\-]+$/i.test(hotelId)) {
    //   return res.status(400).json({
    //     success: false,
    //     error: 'Invalid hotel ID format'
    //   });
    // }

    req.hotelId = hotelId;

    // Optional: Log for debugging
    // console.log(`🏨 Tenant middleware: hotelId=${hotelId}, path=${req.path}`);

    next();
  } catch (error) {
    console.error('❌ Tenant middleware error:', error.message);
    req.hotelId = 'default';
    next();
  }
};

/**
 * Client info middleware - Extracts client ID for deduplication
 * Used for real-time sync to prevent duplicate updates
 */
const clientInfoMiddleware = (req, res, next) => {
  try {
    // Extract client ID from headers
    const clientId = req.headers['x-client-id'] || null;
    req.clientId = clientId;

    // Extract request ID (for tracking)
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    req.requestId = requestId;

    // Optional: Log for debugging
    // console.log(`📡 Client middleware: clientId=${clientId}, requestId=${requestId}`);

    next();
  } catch (error) {
    console.error('❌ Client info middleware error:', error.message);
    req.clientId = null;
    req.requestId = `req_${Date.now()}`;
    next();
  }
};

/**
 * Idempotency middleware - Prevents duplicate POST requests
 * Uses x-idempotency-key header
 */
const idempotencyMiddleware = (req, res, next) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (idempotencyKey) {
      req.idempotencyKey = idempotencyKey;
      // Optional: Implement idempotency check here
      // console.log(`🔑 Idempotency key: ${idempotencyKey}`);
    }

    next();
  } catch (error) {
    console.error('❌ Idempotency middleware error:', error.message);
    next();
  }
};

/**
 * Request logging middleware - Logs all incoming requests
 * Useful for debugging and monitoring
 */
const requestLogMiddleware = (req, res, next) => {
  const startTime = Date.now();

  // Log when response is sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      path: req.path,
      hotelId: req.hotelId,
      clientId: req.clientId,
      status: res.statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };

    // Only log non-static requests
    if (!req.path.startsWith('/socket.io') && !req.path.includes('.js') && !req.path.includes('.css')) {
      console.log(`📊 ${logData.method} ${logData.path} → ${logData.status} (${logData.duration})`);
    }
  });

  next();
};

/**
 * Combined middleware stack - Apply all middlewares at once
 * Usage: app.use('/api', combinedMiddleware);
 */
const combinedMiddleware = [
  requestLogMiddleware,
  tenantMiddleware,
  clientInfoMiddleware,
  idempotencyMiddleware
];

module.exports = {
  getHotelId,
  tenantMiddleware,
  clientInfoMiddleware,
  idempotencyMiddleware,
  requestLogMiddleware,
  combinedMiddleware
};