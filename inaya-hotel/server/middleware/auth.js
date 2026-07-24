// server/middleware/auth.js
// Authentication & Authorization Middleware - Production Ready
// Features: JWT + Session, Token Refresh, Security Logging, Permission Checks
// Compatible with index.html (19 admin pages + 9 guest pages)

const jwt = require('jsonwebtoken');

// ============================================================
// CONFIGURATION
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';
const TOKEN_REFRESH_THRESHOLD = parseInt(process.env.TOKEN_REFRESH_THRESHOLD) || 24 * 60 * 60 * 1000; // 24 hours

// Public paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/guest/login',
  '/api/super/tenants/register',
  '/socket.io',
  '/health',
  '/api/guest-hub',       // Guest Hub Public Routes (Agar needed ho)
  '/api/payment',         // Payment Webhooks (Agar needed ho)
  '/api/ai-chat',
  '/api/tickets'
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if path is public (no auth required)
 */
function isPublicPath(path) {
  return PUBLIC_PATHS.some(publicPath => path.startsWith(publicPath));
}

/**
 * Generate JWT token
 */
function generateToken(payload, expiresIn = TOKEN_EXPIRY) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Verify JWT token safely
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Extract token from request
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  return null;
}

/**
 * Log security events (async, non-blocking)
 */
function logSecurityEvent(req, event, details = {}) {
  const db = req.app.get('db');
  if (!db) return;

  // Fire and forget - don't block request
  db.collection('security_logs').insertOne({
    event,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    hotelId: req.hotelId || req.body?.hotelId,
    email: req.user?.email || req.body?.email,
    details,
    timestamp: new Date()
  }).catch(err => {
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ Security log failed:', err.message);
    }
  });
}

// ============================================================
// MAIN AUTH MIDDLEWARE
// ============================================================

/**
 * Main authentication middleware
 * Supports: JWT token + Session-based auth
 * Features: Token refresh, Security logging, Hotel validation
 */
const authMiddleware = (req, res, next) => {
  try {
    // 1️⃣ Check if path is public
    if (isPublicPath(req.path)) {
      return next();
    }

    // 2️⃣ Try JWT token first
    const token = extractToken(req);

    if (token) {
      // Verify JWT token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Attach user info to request
      req.user = {
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        hotelId: decoded.hotelId,
        permissions: decoded.permissions || []
      };

      // 3️⃣ Validate hotelId (prevent unauthorized switching)
      const requestedHotelId = req.headers['x-hotel-id'] || req.query.hotelId;

      if (requestedHotelId && requestedHotelId !== decoded.hotelId) {
        // Only super_admin can switch hotels
        if (decoded.role !== 'super_admin') {
          logSecurityEvent(req, 'UNAUTHORIZED_HOTEL_SWITCH', {
            attempted: requestedHotelId,
            actual: decoded.hotelId,
            email: decoded.email
          });

          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_HOTEL_SWITCH',
            message: 'You cannot access other hotels',
            yourHotelId: decoded.hotelId
          });
        }
        // Super admin can switch
        req.hotelId = requestedHotelId;
      } else {
        req.hotelId = decoded.hotelId;
      }

      // 4️⃣ Token refresh check (if expiring soon)
      if (decoded.exp) {
        const expiresAt = decoded.exp * 1000;
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;

        if (timeUntilExpiry < TOKEN_REFRESH_THRESHOLD && timeUntilExpiry > 0) {
          // Generate new token with extended expiry
          const { iat, exp, ...payload } = decoded;
          const newToken = generateToken(payload);

          // Send new token in response header
          res.setHeader('X-Refreshed-Token', newToken);

          if (process.env.NODE_ENV === 'development') {
            console.log(`🔄 Token refreshed for: ${decoded.email}`);
          }
        }
      }

      return next();
    }

    // 5️⃣ Try session-based auth (fallback)
    if (req.session?.isAdmin || req.session?.user) {
      req.user = req.session.user || {
        email: req.session.adminEmail,
        role: 'admin',
        hotelId: req.session.hotelId,
        permissions: ['all']
      };
      req.hotelId = req.session.hotelId || req.headers['x-hotel-id'];
      return next();
    }

    // 6️⃣ No valid auth found
    logSecurityEvent(req, 'AUTH_REQUIRED', {
      path: req.path,
      method: req.method
    });

    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required. Please login.',
      code: 'NO_TOKEN'
    });

  } catch (error) {
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      logSecurityEvent(req, 'TOKEN_EXPIRED', {
        path: req.path,
        method: req.method
      });

      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Your session has expired. Please login again.',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      logSecurityEvent(req, 'INVALID_TOKEN', {
        path: req.path,
        method: req.method,
        error: error.message
      });

      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Invalid authentication token.',
        code: 'INVALID_TOKEN'
      });
    }

    // Generic error
    console.error('❌ Auth middleware error:', error.message);

    logSecurityEvent(req, 'AUTH_ERROR', {
      path: req.path,
      method: req.method,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      error: 'AUTH_ERROR',
      message: 'Authentication system error',
      code: 'SERVER_ERROR'
    });
  }
};

// ============================================================
// PERMISSION MIDDLEWARE
// ============================================================

/**
 * Check if user has required permission(s)
 * @param {string|string[]} requiredPermissions - Permission(s) to check
 * @param {boolean} requireAll - If true, user must have ALL permissions
 */
const requirePermission = (requiredPermissions, requireAll = false) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AUTH_REQUIRED',
        message: 'Authentication required'
      });
    }

    const userPerms = req.user.permissions || [];
    const permsArray = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    // Super admin has all permissions
    if (req.user.role === 'super_admin' || userPerms.includes('all')) {
      return next();
    }

    let hasPermission;
    if (requireAll) {
      // User must have ALL permissions
      hasPermission = permsArray.every(perm => userPerms.includes(perm));
    } else {
      // User must have ANY permission
      hasPermission = permsArray.some(perm => userPerms.includes(perm));
    }

    if (!hasPermission) {
      logSecurityEvent(req, 'PERMISSION_DENIED', {
        required: permsArray,
        user: req.user.email,
        role: req.user.role,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        error: 'PERMISSION_DENIED',
        message: `You don't have permission to perform this action`,
        required: permsArray,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

// ============================================================
// ROLE-BASED MIDDLEWARE
// ============================================================

/**
 * Super admin only middleware
 */
const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'super_admin') {
    logSecurityEvent(req, 'SUPER_ADMIN_REQUIRED', {
      user: req.user.email,
      role: req.user.role,
      path: req.path
    });

    return res.status(403).json({
      success: false,
      error: 'SUPER_ADMIN_REQUIRED',
      message: 'Super admin access required',
      code: 'FORBIDDEN'
    });
  }

  next();
};

/**
 * Admin only middleware (hotel admin)
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    logSecurityEvent(req, 'ADMIN_REQUIRED', {
      user: req.user.email,
      role: req.user.role,
      path: req.path
    });

    return res.status(403).json({
      success: false,
      error: 'ADMIN_REQUIRED',
      message: 'Admin access required',
      code: 'FORBIDDEN'
    });
  }

  next();
};

/**
 * Guest only middleware
 */
const guestOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'guest') {
    return res.status(403).json({
      success: false,
      error: 'GUEST_ONLY',
      message: 'This endpoint is for guests only',
      code: 'FORBIDDEN'
    });
  }

  next();
};

// ============================================================
// OPTIONAL AUTH MIDDLEWARE
// ============================================================

/**
 * Optional auth - attaches user if token present, but doesn't fail if missing
 * Useful for endpoints that work for both authenticated and anonymous users
 */
const optionalAuth = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (token) {
      const decoded = verifyToken(token);

      if (decoded) {
        req.user = {
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
          hotelId: decoded.hotelId,
          permissions: decoded.permissions || []
        };

        req.hotelId = req.headers['x-hotel-id'] || decoded.hotelId;
      }
    }

    // Also check session
    if (!req.user && (req.session?.isAdmin || req.session?.user)) {
      req.user = req.session.user || {
        email: req.session.adminEmail,
        role: 'admin',
        hotelId: req.session.hotelId,
        permissions: ['all']
      };
      req.hotelId = req.session.hotelId || req.headers['x-hotel-id'];
    }

    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ Optional auth error:', error.message);
    }
    next();
  }
};

// ============================================================
// HOTEL VALIDATION MIDDLEWARE
// ============================================================

/**
 * Validate that user can access requested hotel
 * Prevents cross-hotel data access
 */
const validateHotelAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required'
    });
  }

  const requestedHotelId = req.hotelId || req.headers['x-hotel-id'] || req.query.hotelId;

  if (!requestedHotelId) {
    return res.status(400).json({
      success: false,
      error: 'HOTEL_ID_REQUIRED',
      message: 'Hotel ID is required'
    });
  }

  // Super admin can access any hotel
  if (req.user.role === 'super_admin') {
    req.hotelId = requestedHotelId;
    return next();
  }

  // Regular users can only access their own hotel
  if (req.user.hotelId !== requestedHotelId) {
    logSecurityEvent(req, 'CROSS_HOTEL_ACCESS_ATTEMPT', {
      user: req.user.email,
      userHotel: req.user.hotelId,
      requestedHotel: requestedHotelId,
      path: req.path
    });

    return res.status(403).json({
      success: false,
      error: 'CROSS_HOTEL_ACCESS_DENIED',
      message: 'You cannot access data from other hotels',
      yourHotelId: req.user.hotelId,
      code: 'FORBIDDEN'
    });
  }

  next();
};

// ============================================================
// RATE LIMITING HELPER
// ============================================================

/**
 * Simple in-memory rate limiter for auth endpoints
 */
const authRateLimiter = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = `${req.ip}_${req.body?.email || 'unknown'}`;
    const now = Date.now();

    // Clean old entries
    for (const [k, data] of attempts.entries()) {
      if (now - data.timestamp > windowMs) {
        attempts.delete(k);
      }
    }

    const current = attempts.get(key) || { count: 0, timestamp: now };

    if (current.count >= maxAttempts) {
      logSecurityEvent(req, 'RATE_LIMIT_EXCEEDED', {
        ip: req.ip,
        email: req.body?.email,
        attempts: current.count
      });

      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many login attempts. Please try again after ${Math.ceil(windowMs / 60000)} minutes.`,
        retryAfter: Math.ceil((current.timestamp + windowMs - now) / 1000)
      });
    }

    current.count++;
    current.timestamp = now;
    attempts.set(key, current);

    next();
  };
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Main middleware
  authMiddleware,
  optionalAuth,

  // Permission/Role middleware
  requirePermission,
  superAdminOnly,
  adminOnly,
  guestOnly,

  // Validation middleware
  validateHotelAccess,

  // Rate limiting
  authRateLimiter,

  // Helper functions
  generateToken,
  verifyToken,
  extractToken,
  isPublicPath,
  logSecurityEvent,

  // Configuration
  PUBLIC_PATHS,
  JWT_SECRET,
  TOKEN_EXPIRY
};
