const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ============================================
// JWT AUTHENTICATION MIDDLEWARE
// ============================================

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
    let token;

    // Check if token exists in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    // Also check in cookies (optional)
    if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Not authorized to access this route. Please login.'
        });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user and attach to request
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found. Invalid token.'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Your account has been deactivated. Please contact admin.'
            });
        }

        req.user = user;
        req.userId = user._id;
        req.userRole = user.role;
        req.hotelId = user.hotelId;

        next();
    } catch (error) {
        console.error('Auth Error:', error.message);

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token. Please login again.'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired. Please login again.'
            });
        }

        res.status(401).json({
            success: false,
            error: 'Not authorized. Authentication failed.'
        });
    }
};

// ============================================
// ROLE BASED AUTHORIZATION
// ============================================

// Authorize based on user roles
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authorized. Please login.'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: `Role '${req.user.role}' is not authorized to access this route. Required roles: ${roles.join(', ')}`
            });
        }

        next();
    };
};

// ============================================
// PERMISSION BASED AUTHORIZATION
// ============================================

// Check if user has specific permission
const checkPermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authorized. Please login.'
            });
        }

        // Super admin has all permissions
        if (req.user.role === 'super_admin') {
            return next();
        }

        // Check if user has the required permission
        const userPermissions = req.user.permissions || [];

        if (!userPermissions.includes(permission) && !userPermissions.includes('all')) {
            return res.status(403).json({
                success: false,
                error: `Permission '${permission}' required to access this route.`
            });
        }

        next();
    };
};

// ============================================
// HOTEL ACCESS VALIDATION
// ============================================

// Check if user can access the requested hotel
const checkHotelAccess = (req, res, next) => {
    const requestedHotelId = req.params.hotelId || req.body.hotelId || req.query.hotelId;

    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Not authorized. Please login.'
        });
    }

    // Super admin can access all hotels
    if (req.user.role === 'super_admin') {
        req.hotelId = requestedHotelId || req.user.hotelId;
        return next();
    }

    // Hotel admin and staff can only access their own hotel
    if (req.user.hotelId !== requestedHotelId && requestedHotelId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied. You can only access your own hotel data.'
        });
    }

    req.hotelId = req.user.hotelId;
    next();
};

// ============================================
// SELF ACCESS CHECK
// ============================================

// Check if user is accessing their own data (for profile routes)
const checkSelf = (req, res, next) => {
    const userId = req.params.userId || req.params.id;

    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Not authorized. Please login.'
        });
    }

    // Admin can access anyone's data, users can only access their own
    if (req.user.role !== 'super_admin' && req.user.role !== 'hotel_admin' && req.user._id.toString() !== userId) {
        return res.status(403).json({
            success: false,
            error: 'Access denied. You can only access your own data.'
        });
    }

    next();
};

// ============================================
// OPTIONAL AUTH (for routes that work with or without auth)
// ============================================

// Optional authentication - doesn't throw error if no token
const optionalAuth = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');
            if (user && user.isActive) {
                req.user = user;
                req.userId = user._id;
                req.userRole = user.role;
                req.hotelId = user.hotelId;
            }
        } catch (error) {
            // Don't throw error for optional auth
            console.log('Optional auth failed:', error.message);
        }
    }

    next();
};

// ============================================
// RATE LIMIT BY ROLE
// ============================================

// Different rate limits for different roles
const getRateLimitByRole = (req) => {
    if (!req.user) return 50; // Guest limit

    switch (req.user.role) {
        case 'super_admin':
            return 1000;
        case 'hotel_admin':
            return 500;
        case 'staff':
            return 200;
        default:
            return 50;
    }
};

// ============================================
// EXPORT ALL MIDDLEWARES
// ============================================

module.exports = {
    protect,                    // Main auth - requires login
    authorize,                  // Role-based access
    checkPermission,            // Permission-based access
    checkHotelAccess,          // Hotel-specific access
    checkSelf,                 // Self data access
    optionalAuth,              // Optional auth (no error)
    getRateLimitByRole         // Role-based rate limiting
};
