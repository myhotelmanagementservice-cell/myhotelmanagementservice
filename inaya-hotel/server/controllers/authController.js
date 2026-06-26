// server/controllers/authController.js
// Authentication Controller - Native MongoDB Compatible

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB, isConnected } = require('../config/db');
const { generateToken } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

// ============================================================
// CONSTANTS
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// ============================================================
// 🔐 ADMIN LOGIN (TENANTS COLLECTION BASED)
// ============================================================
exports.adminLogin = async (req, res) => {
    try {
        const { email, password, hotelId } = req.body;

        if (!email || !password || !hotelId) {
            return error(res, 'Email, password, and hotelId are required', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const normalizedEmail = email.toLowerCase().trim();

        console.log(`🔐 Login attempt: ${normalizedEmail} for hotel: ${hotelId}`);

        // Find tenant
        const tenant = await db.collection('tenants').findOne({
            hotelId: hotelId,
            adminEmail: normalizedEmail
        });

        if (!tenant) {
            console.log('❌ Tenant not found');
            return error(res, 'Invalid Hotel ID or Email', 401);
        }

        // Check active
        if (tenant.active === false) {
            return error(res, 'Hotel account is inactive', 403);
        }

        // Plain text password check
        if (password !== tenant.adminPassword) {
            console.log('❌ Wrong password');
            return error(res, 'Invalid password', 401);
        }

        // Default permissions
        const permissions = [
            'rooms',
            'guests',
            'food',
            'inventory',
            'requests',
            'settings',
            'staff',
            'bookings'
        ];

        // Generate token
        const token = generateToken({
            id: tenant._id.toString(),
            email: tenant.adminEmail,
            name: tenant.hotelName,
            role: 'admin',
            hotelId: tenant.hotelId,
            permissions
        });

        // Session
        req.session.isAdmin = true;
        req.session.adminEmail = tenant.adminEmail;
        req.session.hotelId = tenant.hotelId;
        req.session.user = {
            id: tenant._id.toString(),
            email: tenant.adminEmail,
            name: tenant.hotelName,
            role: 'admin',
            permissions
        };

        console.log(`✅ Login successful: ${tenant.adminEmail}`);

        return success(res, {
            token,
            user: {
                id: tenant._id.toString(),
                email: tenant.adminEmail,
                name: tenant.hotelName,
                role: 'admin',
                hotelId: tenant.hotelId,
                permissions
            },
            hotelId: tenant.hotelId,
            hotelName: tenant.hotelName
        }, 'Login successful');

    } catch (err) {
        console.error('❌ Login error:', err);
        return error(res, 'Login failed: ' + err.message, 500);
    }
};

// ============================================================
// 🔑 CHANGE PASSWORD
// ============================================================
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return error(res, 'Current and new password are required', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        const tenant = await db.collection('tenants').findOne({
            hotelId: req.user.hotelId
        });

        if (!tenant) {
            return error(res, 'Hotel not found', 404);
        }

        if (tenant.adminPassword !== currentPassword) {
            return error(res, 'Current password is incorrect', 401);
        }

        await db.collection('tenants').updateOne(
            { hotelId: req.user.hotelId },
            {
                $set: {
                    adminPassword: newPassword,
                    updatedAt: new Date()
                }
            }
        );

        return success(res, null, 'Password changed successfully');

    } catch (err) {
        console.error('❌ Change password error:', err);
        return error(res, 'Failed to change password: ' + err.message, 500);
    }
};

// ============================================================
// 🔄 REFRESH TOKEN
// ============================================================
exports.refreshToken = (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return error(res, 'No token provided', 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET, {
            ignoreExpiration: true
        });

        const newToken = jwt.sign({
            id: decoded.id,
            email: decoded.email,
            name: decoded.name,
            role: decoded.role,
            hotelId: decoded.hotelId,
            permissions: decoded.permissions
        }, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN
        });

        return success(res, {
            token: newToken
        }, 'Token refreshed');

    } catch (err) {
        return error(res, 'Invalid token', 401);
    }
};

// ============================================================
// ✅ CHECK SESSION
// ============================================================
exports.checkSession = (req, res) => {

    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);

            return success(res, {
                isAdmin: true,
                email: decoded.email,
                hotelId: decoded.hotelId,
                role: decoded.role,
                name: decoded.name,
                permissions: decoded.permissions
            });

        } catch (e) {
            console.warn('⚠️ Token verification failed');
        }
    }

    if (req.session?.isAdmin) {
        return success(res, {
            isAdmin: true,
            email: req.session.adminEmail,
            hotelId: req.session.hotelId
        });
    }

    return success(res, {
        isAdmin: false
    }, 'No active session');
};

// ============================================================
// 🚪 LOGOUT
// ============================================================
exports.logout = (req, res) => {
    try {

        if (req.session) {
            req.session.destroy();
        }

        return success(res, null, 'Logged out successfully');

    } catch (err) {

        return success(res, null, 'Logged out');
    }
};

// ============================================================
// 👤 GET CURRENT USER
// ============================================================
exports.getCurrentUser = async (req, res) => {

    try {

        if (!req.user?.hotelId) {
            return error(res, 'Not authenticated', 401);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        const tenant = await db.collection('tenants').findOne(
            { hotelId: req.user.hotelId },
            {
                projection: {
                    adminPassword: 0
                }
            }
        );

        if (!tenant) {
            return error(res, 'Hotel not found', 404);
        }

        return success(res, {
            email: tenant.adminEmail,
            name: tenant.hotelName,
            hotelId: tenant.hotelId,
            role: 'admin'
        });

    } catch (err) {

        console.error('❌ Get current user error:', err);
        return error(res, err.message, 500);
    }
};