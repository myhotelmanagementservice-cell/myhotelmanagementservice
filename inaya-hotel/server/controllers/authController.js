// server/controllers/authController.js
// Authentication Controller - Native MongoDB Compatible
// Features: Login, Session, Logout, Password Change, Token Refresh

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
// 🔐 ADMIN LOGIN
// ============================================================
exports.adminLogin = async (req, res) => {
    try {
        const { email, password, hotelId } = req.body;

        // ✅ Validation
        if (!email || !password || !hotelId) {
            return error(res, 'Email, password, and hotelId are required', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const normalizedEmail = email.toLowerCase().trim();

        console.log(`🔐 Login attempt: ${normalizedEmail} for hotel: ${hotelId}`);

        // ✅ STEP 1: Verify hotel exists and is active
        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            console.log(`❌ Hotel not found: ${hotelId}`);
            return error(res, 'Hotel not found. Please check Hotel ID.', 404);
        }

        if (tenant.active === false) {
            return error(res, 'Hotel account is inactive', 403);
        }

        // ✅ STEP 2: STRICT hotelId match (most important!)
        const user = await db.collection('users').findOne({
            email: normalizedEmail,
            hotelId: hotelId,
            isDeleted: { $ne: true }
        });

        if (!user) {
            console.log(`❌ User not found: ${normalizedEmail} in hotel: ${hotelId}`);

            // Debug: check if user exists in another hotel
            const userOther = await db.collection('users').findOne({
                email: normalizedEmail,
                isDeleted: { $ne: true }
            });

            if (userOther) {
                return error(
                    res,
                    `This account belongs to hotel ${userOther.hotelId}, not ${hotelId}`,
                    403
                );
            }

            return error(res, 'Invalid credentials for this hotel', 401);
        }

        // ✅ STEP 3: Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log(`❌ Wrong password for: ${normalizedEmail}`);
            return error(res, 'Invalid password', 401);
        }

        // ✅ STEP 4: Check if user is active
        if (user.active === false) {
            return error(res, 'Account is inactive', 403);
        }

        // ✅ STEP 5: Update login stats
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { lastLogin: new Date(), updatedAt: new Date() },
                $inc: { loginCount: 1 }
            }
        );

        // ✅ STEP 6: Generate token
        const token = generateToken({
            email: user.email,
            name: user.name,
            role: user.role,
            hotelId: hotelId,
            permissions: user.permissions
        });

        // ✅ STEP 7: Set session
        req.session.isAdmin = true;
        req.session.adminEmail = normalizedEmail;
        req.session.hotelId = hotelId;
        req.session.user = {
            email: user.email,
            name: user.name,
            role: user.role,
            permissions: user.permissions
        };

        console.log(`✅ Login successful: ${normalizedEmail} for hotel: ${hotelId}`);

        return success(res, {
            token,
            user: {
                email: user.email,
                name: user.name,
                role: user.role,
                hotelId: hotelId,
                permissions: user.permissions
            },
            hotelId: hotelId,
            hotelName: tenant.hotelName || 'Hotel'
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
        const userId = req.user?.id;

        if (!currentPassword || !newPassword) {
            return error(res, 'Current and new password are required', 400);
        }

        if (newPassword.length < 8) {
            return error(res, 'New password must be at least 8 characters', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const { ObjectId } = require('mongodb');

        const user = await db.collection('users').findOne({
            _id: new ObjectId(userId),
            isDeleted: { $ne: true }
        });

        if (!user) {
            return error(res, 'User not found', 404);
        }

        // Verify current password
        const validCurrent = await bcrypt.compare(currentPassword, user.password);
        if (!validCurrent) {
            return error(res, 'Current password is incorrect', 401);
        }

        // Hash and save new password
        const hashedNew = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { password: hashedNew, updatedAt: new Date() } }
        );

        console.log(`✅ Password changed for: ${user.email}`);
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
        const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });

        // Generate new token
        const newToken = jwt.sign(
            {
                email: decoded.email,
                name: decoded.name,
                role: decoded.role,
                hotelId: decoded.hotelId,
                permissions: decoded.permissions
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return success(res, { token: newToken }, 'Token refreshed');

    } catch (err) {
        console.error('❌ Token refresh error:', err);
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
            console.warn('⚠️ Token verification failed:', e.message);
        }
    }

    if (req.session?.isAdmin) {
        return success(res, {
            isAdmin: true,
            email: req.session.adminEmail,
            hotelId: req.session.hotelId || 'default'
        });
    }

    return success(res, { isAdmin: false }, 'No active session');
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
        console.error('❌ Logout error:', err);
        return success(res, null, 'Logged out');
    }
};

// ============================================================
// 👤 GET CURRENT USER
// ============================================================
exports.getCurrentUser = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return error(res, 'Not authenticated', 401);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();
        const { ObjectId } = require('mongodb');

        const user = await db.collection('users').findOne(
            { _id: new ObjectId(userId), isDeleted: { $ne: true } },
            { projection: { password: 0 } }
        );

        if (!user) {
            return error(res, 'User not found', 404);
        }

        if (user._id) user._id = user._id.toString();
        return success(res, user);

    } catch (err) {
        console.error('❌ Get current user error:', err);
        return error(res, err.message, 500);
    }
};