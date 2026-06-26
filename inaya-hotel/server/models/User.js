// server/models/User.js
// User Management Model - Native MongoDB Compatible
// Features: Authentication, Role-based Access, Multi-tenant, Permissions
// Compatible with index.html (19 admin pages + 9 guest pages)

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================

/**
 * User roles
 */
const USER_ROLES = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    STAFF: 'staff',
    GUEST: 'guest'
};

/**
 * User status options
 */
const USER_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    PENDING: 'pending'
};

/**
 * Default permissions by role
 */
const DEFAULT_PERMISSIONS = {
    [USER_ROLES.SUPER_ADMIN]: ['all'],
    [USER_ROLES.ADMIN]: [
        'rooms', 'guests', 'food', 'inventory', 'requests', 
        'settings', 'staff', 'bookings', 'reports', 'cab',
        'announcements', 'policies', 'departments', 'maintenance',
        'blacklist', 'reviews', 'logs'
    ],
    [USER_ROLES.STAFF]: [
        'rooms', 'guests', 'requests', 'bookings'
    ],
    [USER_ROLES.GUEST]: [
        'view_menu', 'place_order', 'make_request', 'view_bookings'
    ]
};

/**
 * JWT configuration
 */
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validatePassword(password) {
    const errors = [];

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }

    // Optional: Add more password strength checks
    // if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
    // if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
    // if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate user data
 * @param {Object} data - User data
 * @param {boolean} isUpdate - Whether this is an update operation
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateUser(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.email || !isValidEmail(data.email)) {
            errors.push('Valid email is required');
        }

        if (!data.password) {
            errors.push('Password is required');
        } else {
            const passwordValidation = validatePassword(data.password);
            if (!passwordValidation.valid) {
                errors.push(...passwordValidation.errors);
            }
        }

        if (!data.name || data.name.trim() === '') {
            errors.push('Name is required');
        }

        if (!data.hotelId || data.hotelId.trim() === '') {
            errors.push('Hotel ID is required');
        }
    }

    // Validate email if provided (for updates)
    if (isUpdate && data.email && !isValidEmail(data.email)) {
        errors.push('Invalid email format');
    }

    // Validate role
    if (data.role && !Object.values(USER_ROLES).includes(data.role)) {
        errors.push(`Invalid role. Must be one of: ${Object.values(USER_ROLES).join(', ')}`);
    }

    // Validate status
    if (data.status && !Object.values(USER_STATUS).includes(data.status)) {
        errors.push(`Invalid status. Must be one of: ${Object.values(USER_STATUS).join(', ')}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ============================================================
// PASSWORD HASHING
// ============================================================

/**
 * Hash password
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

/**
 * Compare password
 * @param {string} password - Plain text password
 * @param {string} hashedPassword - Hashed password
 * @returns {Promise<boolean>} - True if match
 */
async function comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
}

// ============================================================
// JWT TOKEN MANAGEMENT
// ============================================================

/**
 * Generate JWT token
 * @param {Object} user - User object
 * @returns {string} - JWT token
 */
function generateToken(user) {
    const payload = {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        hotelId: user.hotelId,
        permissions: user.permissions
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded payload or null
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Create a new user
 * @param {Object} userData - User data
 * @returns {Promise<Object>} - Created user
 */
async function createUser(userData) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Validate data
        const validation = validateUser(userData);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if email already exists for this hotel
        const existingUser = await db.collection('users').findOne({
            email: userData.email.toLowerCase().trim(),
            hotelId: userData.hotelId
        });

        if (existingUser) {
            throw new Error('User with this email already exists for this hotel');
        }

        // Hash password
        const hashedPassword = await hashPassword(userData.password);

        // Set default permissions based on role
        const role = userData.role || USER_ROLES.STAFF;
        const permissions = userData.permissions || DEFAULT_PERMISSIONS[role] || [];

        const newUser = {
            email: userData.email.toLowerCase().trim(),
            password: hashedPassword,
            name: userData.name.trim(),
            role: role,
            hotelId: userData.hotelId,
            permissions: permissions,
            status: userData.status || USER_STATUS.ACTIVE,
            phone: userData.phone || '',
            avatar: userData.avatar || '',
            lastLogin: null,
            loginCount: 0,
            _version: 1,
            isDeleted: false,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('users').insertOne(newUser);
        newUser._id = result.insertedId.toString();

        // Remove password from response
        delete newUser.password;

        console.log(`✅ User created: ${newUser.email} (Hotel: ${newUser.hotelId})`);
        return newUser;
    } catch (error) {
        console.error('❌ createUser error:', error.message);
        throw error;
    }
}

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - User or null
 */
async function getUserById(userId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        if (!ObjectId.isValid(userId)) return null;

        const user = await db.collection('users').findOne({
            _id: new ObjectId(userId),
            isDeleted: { $ne: true }
        });

        if (user) {
            user._id = user._id.toString();
            delete user.password;
        }

        return user;
    } catch (error) {
        console.error('❌ getUserById error:', error.message);
        return null;
    }
}

/**
 * Get user by email and hotel
 * @param {string} email - User email
 * @param {string} hotelId - Hotel ID
 * @returns {Promise<Object|null>} - User or null
 */
async function getUserByEmail(email, hotelId) {
    try {
        if (!isConnected()) return null;

        const db = getDB();
        if (!db) return null;

        const user = await db.collection('users').findOne({
            email: email.toLowerCase().trim(),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (user) {
            user._id = user._id.toString();
            // Don't delete password here - needed for authentication
        }

        return user;
    } catch (error) {
        console.error('❌ getUserByEmail error:', error.message);
        return null;
    }
}

/**
 * Get all users for a hotel
 * @param {string} hotelId - Hotel ID
 * @param {Object} options - Filter options
 * @returns {Promise<Object>} - { users, total, page, limit, pages }
 */
async function getUsers(hotelId, options = {}) {
    try {
        if (!isConnected()) {
            return { users: [], total: 0, page: 1, limit: 50, pages: 0 };
        }

        const db = getDB();
        if (!db) {
            return { users: [], total: 0, page: 1, limit: 50, pages: 0 };
        }

        const { search, role, status, limit = 50, page = 1 } = options;

        let filter = { hotelId, isDeleted: { $ne: true } };

        if (role) filter.role = role;
        if (status) filter.status = status;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phone: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            db.collection('users')
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('users').countDocuments(filter)
        ]);

        // Remove passwords and convert IDs
        users.forEach(user => {
            user._id = user._id.toString();
            delete user.password;
        });

        return {
            users,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
        };
    } catch (error) {
        console.error('❌ getUsers error:', error.message);
        return { users: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

/**
 * Update user
 * @param {string} userId - User ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} - Updated user
 */
async function updateUser(userId, updates) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        if (!ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID');
        }

        // Get current user
        const currentUser = await db.collection('users').findOne({
            _id: new ObjectId(userId),
            isDeleted: { $ne: true }
        });

        if (!currentUser) {
            throw new Error('User not found');
        }

        // Validate updates
        const validation = validateUser(updates, true);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if email is being changed and if it already exists
        if (updates.email && updates.email !== currentUser.email) {
            const existingUser = await db.collection('users').findOne({
                email: updates.email.toLowerCase().trim(),
                hotelId: currentUser.hotelId,
                _id: { $ne: new ObjectId(userId) },
                isDeleted: { $ne: true }
            });

            if (existingUser) {
                throw new Error('User with this email already exists for this hotel');
            }
        }

        // Build update object
        const updateData = { updatedAt: new Date() };

        if (updates.name) updateData.name = updates.name.trim();
        if (updates.email) updateData.email = updates.email.toLowerCase().trim();
        if (updates.role) updateData.role = updates.role;
        if (updates.status) updateData.status = updates.status;
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
        if (updates.permissions) updateData.permissions = updates.permissions;

        // Hash password if provided
        if (updates.password) {
            const passwordValidation = validatePassword(updates.password);
            if (!passwordValidation.valid) {
                throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
            }
            updateData.password = await hashPassword(updates.password);
        }

        const result = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(userId) },
            {
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error('Failed to update user');
        }

        result._id = result._id.toString();
        delete result.password;

        console.log(`✅ User updated: ${result.email}`);
        return result;
    } catch (error) {
        console.error('❌ updateUser error:', error.message);
        throw error;
    }
}

/**
 * Delete user (soft delete)
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - Success status
 */
async function deleteUser(userId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        if (!ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID');
        }

        const result = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(userId), isDeleted: { $ne: true } },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    status: USER_STATUS.INACTIVE,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            console.warn(`⚠️ User not found (ID: ${userId})`);
            return false;
        }

        console.log(`✅ User deleted (soft) (ID: ${userId})`);
        return true;
    } catch (error) {
        console.error('❌ deleteUser error:', error.message);
        throw error;
    }
}

/**
 * Permanently delete user (hard delete)
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - Success status
 */
async function permanentlyDeleteUser(userId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        if (!ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID');
        }

        const result = await db.collection('users').deleteOne({
            _id: new ObjectId(userId)
        });

        if (result.deletedCount === 0) {
            console.warn(`⚠️ User not found (ID: ${userId})`);
            return false;
        }

        console.log(`✅ User permanently deleted (ID: ${userId})`);
        return true;
    } catch (error) {
        console.error('❌ permanentlyDeleteUser error:', error.message);
        throw error;
    }
}

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * Authenticate user
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @param {string} hotelId - Hotel ID
 * @returns {Promise<Object>} - { user, token }
 */
async function authenticateUser(email, password, hotelId) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        // Find user
        const user = await db.collection('users').findOne({
            email: email.toLowerCase().trim(),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!user) {
            throw new Error('Invalid email or password');
        }

        // Check if user is active
        if (user.status !== USER_STATUS.ACTIVE) {
            throw new Error(`User account is ${user.status}`);
        }

        // Verify password
        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Invalid email or password');
        }

        // Update last login
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { lastLogin: new Date() },
                $inc: { loginCount: 1 }
            }
        );

        // Generate token
        user._id = user._id.toString();
        const token = generateToken(user);

        // Remove password from response
        delete user.password;

        console.log(`✅ User authenticated: ${user.email}`);
        return { user, token };
    } catch (error) {
        console.error('❌ authenticateUser error:', error.message);
        throw error;
    }
}

/**
 * Change password
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {Promise<boolean>} - Success status
 */
async function changePassword(userId, currentPassword, newPassword) {
    try {
        if (!isConnected()) {
            throw new Error('Database not connected');
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database instance not available');
        }

        if (!ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID');
        }

        // Get user with password
        const user = await db.collection('users').findOne({
            _id: new ObjectId(userId),
            isDeleted: { $ne: true }
        });

        if (!user) {
            throw new Error('User not found');
        }

        // Verify current password
        const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            throw new Error('Current password is incorrect');
        }

        // Validate new password
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
            throw new Error(`New password validation failed: ${passwordValidation.errors.join(', ')}`);
        }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update password
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    password: hashedPassword,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            }
        );

        console.log(`✅ Password changed for user: ${user.email}`);
        return true;
    } catch (error) {
        console.error('❌ changePassword error:', error.message);
        throw error;
    }
}

// ============================================================
// PERMISSION CHECKS
// ============================================================

/**
 * Check if user has permission
 * @param {Object} user - User object
 * @param {string} permission - Permission to check
 * @returns {boolean} - True if has permission
 */
function hasPermission(user, permission) {
    if (!user || !user.permissions) return false;

    // Super admin has all permissions
    if (user.role === USER_ROLES.SUPER_ADMIN) return true;

    // Check if user has 'all' permission
    if (user.permissions.includes('all')) return true;

    // Check specific permission
    return user.permissions.includes(permission);
}

/**
 * Check if user has role
 * @param {Object} user - User object
 * @param {string} role - Role to check
 * @returns {boolean} - True if has role
 */
function hasRole(user, role) {
    if (!user || !user.role) return false;
    return user.role === role;
}

// ============================================================
// STATISTICS
// ============================================================

/**
 * Get user statistics for a hotel
 * @param {string} hotelId - Hotel ID
 * @returns {Promise<Object>} - Statistics
 */
async function getUserStats(hotelId) {
    try {
        if (!isConnected()) {
            return { total: 0, byRole: {}, byStatus: {}, active: 0 };
        }

        const db = getDB();
        if (!db) {
            return { total: 0, byRole: {}, byStatus: {}, active: 0 };
        }

        const stats = await db.collection('users').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$status', USER_STATUS.ACTIVE] }, 1, 0] } },
                    byRole: { $push: '$role' },
                    byStatus: { $push: '$status' }
                }
            }
        ]).toArray();

        const result = stats[0] || { total: 0, active: 0, byRole: [], byStatus: [] };

        // Count by role
        const roleCount = {};
        result.byRole.forEach(role => {
            roleCount[role] = (roleCount[role] || 0) + 1;
        });

        // Count by status
        const statusCount = {};
        result.byStatus.forEach(status => {
            statusCount[status] = (statusCount[status] || 0) + 1;
        });

        return {
            total: result.total,
            active: result.active,
            byRole: roleCount,
            byStatus: statusCount
        };
    } catch (error) {
        console.error('❌ getUserStats error:', error.message);
        return { total: 0, byRole: {}, byStatus: {}, active: 0 };
    }
}

/**
 * Get user count for a hotel
 * @param {string} hotelId - Hotel ID
 * @param {Object} filters - Filter options
 * @returns {Promise<number>} - Count
 */
async function getUserCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;

        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };

        if (filters.role) query.role = filters.role;
        if (filters.status) query.status = filters.status;

        return await db.collection('users').countDocuments(query);
    } catch (error) {
        console.error('❌ getUserCount error:', error.message);
        return 0;
    }
}

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Create indexes for users collection
 */
async function createIndexes() {
    try {
        if (!isConnected()) return;

        const db = getDB();
        if (!db) return;

        // Compound unique index: email + hotelId
        await db.collection('users').createIndex(
            { email: 1, hotelId: 1 },
            { unique: true, background: true, name: 'email_hotelId_unique' }
        );

        // Index for role-based queries
        await db.collection('users').createIndex(
            { hotelId: 1, role: 1 },
            { background: true, name: 'hotelId_role_idx' }
        );

        // Index for status-based queries
        await db.collection('users').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );

        // Index for soft delete
        await db.collection('users').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ User indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Constants
    USER_ROLES,
    USER_STATUS,
    DEFAULT_PERMISSIONS,
    JWT_SECRET,
    JWT_EXPIRES_IN,

    // Validation
    isValidEmail,
    validatePassword,
    validateUser,

    // Password hashing
    hashPassword,
    comparePassword,

    // JWT
    generateToken,
    verifyToken,

    // CRUD operations
    createUser,
    getUserById,
    getUserByEmail,
    getUsers,
    updateUser,
    deleteUser,
    permanentlyDeleteUser,

    // Authentication
    authenticateUser,
    changePassword,

    // Permissions
    hasPermission,
    hasRole,

    // Statistics
    getUserStats,
    getUserCount,

    // Index management
    createIndexes
};