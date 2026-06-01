const jwt = require('jsonwebtoken');

/**
 * Verify JWT token and attach user to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Allow public routes to pass through
      if (req.path === '/health' || req.path === '/api/health') {
        return next();
      }
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required',
        message: 'No token provided'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = {
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      hotelId: decoded.hotelId,
      permissions: decoded.permissions || []
    };

    // Override hotelId from header if provided (for multi-tenant switching)
    if (req.headers['x-hotel-id']) {
      req.hotelId = req.headers['x-hotel-id'];
    } else {
      req.hotelId = decoded.hotelId;
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired',
        message: 'Please login again'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token',
        message: 'Token verification failed'
      });
    }
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication error',
      message: 'Internal server error'
    });
  }
};

/**
 * Check if user has required permission
 * @param {string|string[]} requiredPermissions - Permission(s) to check
 * @returns {Function} Express middleware
 */
const requirePermission = (requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    const userPerms = req.user.permissions || [];
    const permsArray = Array.isArray(requiredPermissions) 
      ? requiredPermissions 
      : [requiredPermissions];

    // Check if user has any of the required permissions
    const hasPermission = permsArray.some(perm => 
      userPerms.includes(perm) || userPerms.includes('all') || req.user.role === 'super_admin'
    );

    if (!hasPermission) {
      return res.status(403).json({ 
        success: false, 
        error: 'Insufficient permissions',
        message: `Required: ${permsArray.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Super admin only middleware
 */
const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ 
      success: false, 
      error: 'Super admin access required' 
    });
  }
  next();
};

/**
 * Optional auth - attaches user if token present, but doesn't fail if missing
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = {
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        hotelId: decoded.hotelId,
        permissions: decoded.permissions || []
      };
      req.hotelId = req.headers['x-hotel-id'] || decoded.hotelId;
    }

    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};

module.exports = {
  authMiddleware,
  requirePermission,
  superAdminOnly,
  optionalAuth
};
