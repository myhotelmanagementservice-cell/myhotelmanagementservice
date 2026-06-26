// server/controllers/tenantController.js
// Tenant/Hotel Management Controller - Native MongoDB Compatible
// Features: Get, Save, Update, Delete, Status Management, Real-time Sync

const { getDB, isConnected } = require('../config/db');
const { broadcast } = require('../utils/broadcast');
const { success, error } = require('../utils/apiResponse');

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_TENANT = {
    hotelName: 'Crown Plaza Hotel',
    currency: 'USD',
    currencySymbol: '$',
    language: 'en',
    country: 'USA',
    timezone: 'UTC',
    active: true,
    theme: 'default',
    subscriptionType: 'basic'
};

// ============================================================
// 🏨 GET TENANT INFO
// ============================================================
exports.getTenant = async (req, res) => {
    try {
        const hotelId = req.hotelId;

        if (!isConnected()) {
            return success(res, { hotelId, ...DEFAULT_TENANT });
        }

        const db = getDB();
        const tenant = await db.collection('tenants').findOne({ hotelId });

        if (!tenant) {
            return success(res, { hotelId, ...DEFAULT_TENANT });
        }

        if (tenant._id) tenant._id = tenant._id.toString();
        return success(res, tenant);

    } catch (err) {
        console.error('❌ Tenant fetch error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 💾 SAVE/UPDATE TENANT CONFIG
// ============================================================
exports.saveTenant = async (req, res) => {
    try {
        const hotelId = req.hotelId;
        const updates = req.body;

        if (!isConnected()) {
            return success(res, { hotelId }, 'Tenant config saved (offline mode)');
        }

        const db = getDB();

        // Build update object
        const updateData = { updatedAt: new Date() };

        const allowedFields = [
            'hotelName', 'logo', 'currency', 'currencySymbol', 'language', 
            'country', 'active', 'theme', 'subscriptionType', 'timezone',
            'adminEmail', 'phone', 'email', 'address'
        ];

        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                updateData[field] = updates[field];
            }
        });

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            { $set: updateData },
            { upsert: true, returnDocument: 'after' }
        );

        // Broadcast update to all connected clients
        broadcast(hotelId, 'cfg_upd', {
            hotelId,
            hotelName: updateData.hotelName,
            currency: updateData.currency,
            currencySymbol: updateData.currencySymbol,
            language: updateData.language,
            theme: updateData.theme,
            updatedAt: new Date()
        }, req.clientId);

        if (result._id) result._id = result._id.toString();

        return success(res, result, 'Tenant config saved successfully');

    } catch (err) {
        console.error('❌ Tenant save error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔄 UPDATE SPECIFIC TENANT FIELDS
// ============================================================
exports.updateTenant = async (req, res) => {
    try {
        const hotelId = req.hotelId;
        const updates = req.body;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        // Prevent changing hotelId
        delete updates.hotelId;
        delete updates._id;

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            { 
                $set: { ...updates, updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return error(res, 'Tenant not found', 404);
        }

        // Broadcast update
        broadcast(hotelId, 'cfg_upd', {
            hotelId,
            ...updates,
            updatedAt: new Date()
        }, req.clientId);

        if (result._id) result._id = result._id.toString();

        return success(res, result, 'Tenant updated successfully');

    } catch (err) {
        console.error('❌ Tenant update error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🗑️ DELETE TENANT
// ============================================================
exports.deleteTenant = async (req, res) => {
    try {
        const hotelId = req.hotelId;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        // Delete tenant
        const result = await db.collection('tenants').deleteOne({ hotelId });

        if (result.deletedCount === 0) {
            return error(res, 'Tenant not found', 404);
        }

        // Broadcast deletion
        broadcast(hotelId, 'tenant_deleted', { hotelId }, req.clientId);

        return success(res, null, 'Tenant deleted successfully');

    } catch (err) {
        console.error('❌ Tenant delete error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔄 TOGGLE TENANT STATUS (Active/Inactive)
// ============================================================
exports.toggleTenantStatus = async (req, res) => {
    try {
        const hotelId = req.hotelId;

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        const tenant = await db.collection('tenants').findOne({ hotelId });
        if (!tenant) {
            return error(res, 'Tenant not found', 404);
        }

        const newStatus = !tenant.active;

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            { 
                $set: { 
                    active: newStatus,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        // Broadcast status change
        broadcast(hotelId, 'tenant_status', {
            hotelId,
            active: newStatus
        }, req.clientId);

        if (result._id) result._id = result._id.toString();

        return success(res, result, `Tenant ${newStatus ? 'activated' : 'deactivated'}`);

    } catch (err) {
        console.error('❌ Toggle status error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 💳 UPDATE SUBSCRIPTION
// ============================================================
exports.updateSubscription = async (req, res) => {
    try {
        const hotelId = req.hotelId;
        const { subscriptionType, subscriptionExpiry } = req.body;

        if (!subscriptionType) {
            return error(res, 'Subscription type is required', 400);
        }

        if (!isConnected()) {
            return error(res, 'Database not connected', 503);
        }

        const db = getDB();

        const updateData = {
            subscriptionType,
            updatedAt: new Date()
        };

        if (subscriptionExpiry) {
            updateData.subscriptionExpiry = new Date(subscriptionExpiry);
        }

        const result = await db.collection('tenants').findOneAndUpdate(
            { hotelId },
            { 
                $set: updateData,
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            return error(res, 'Tenant not found', 404);
        }

        // Broadcast subscription update
        broadcast(hotelId, 'subscription_upd', {
            hotelId,
            subscriptionType,
            subscriptionExpiry: updateData.subscriptionExpiry
        }, req.clientId);

        if (result._id) result._id = result._id.toString();

        return success(res, result, 'Subscription updated successfully');

    } catch (err) {
        console.error('❌ Subscription update error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 📊 GET TENANT STATISTICS
// ============================================================
exports.getTenantStats = async (req, res) => {
    try {
        const hotelId = req.hotelId;

        if (!isConnected()) {
            return success(res, {
                totalRooms: 0,
                totalGuests: 0,
                totalBookings: 0,
                totalRequests: 0,
                occupancyRate: 0
            });
        }

        const db = getDB();

        // Get counts from various collections
        const [rooms, guests, bookings, requests] = await Promise.all([
            db.collection('rooms').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('guests').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('bookings').countDocuments({ hotelId, isDeleted: { $ne: true } }),
            db.collection('requests').countDocuments({ hotelId, isDeleted: { $ne: true } })
        ]);

        // Calculate occupancy rate
        const occupiedRooms = await db.collection('rooms').countDocuments({
            hotelId,
            status: 'Occupied',
            isDeleted: { $ne: true }
        });

        const occupancyRate = rooms > 0 
            ? ((occupiedRooms / rooms) * 100).toFixed(1)
            : 0;

        return success(res, {
            totalRooms: rooms,
            totalGuests: guests,
            totalBookings: bookings,
            totalRequests: requests,
            occupiedRooms,
            occupancyRate: parseFloat(occupancyRate)
        });

    } catch (err) {
        console.error('❌ Tenant stats error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🌐 GET ALL TENANTS (Super Admin)
// ============================================================
exports.getAllTenants = async (req, res) => {
    try {
        if (!isConnected()) {
            return success(res, []);
        }

        const db = getDB();

        const tenants = await db.collection('tenants')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        tenants.forEach(t => {
            if (t._id) t._id = t._id.toString();
        });

        return success(res, tenants);

    } catch (err) {
        console.error('❌ Get all tenants error:', err);
        return error(res, err.message, 500);
    }
};

// ============================================================
// 🔍 SEARCH TENANTS
// ============================================================
exports.searchTenants = async (req, res) => {
    try {
        const { query, country, subscriptionType, active } = req.query;

        if (!isConnected()) {
            return success(res, []);
        }

        const db = getDB();
        const filter = {};

        if (query) {
            const searchRegex = { $regex: query, $options: 'i' };
            filter.$or = [
                { hotelId: searchRegex },
                { hotelName: searchRegex },
                { adminEmail: searchRegex }
            ];
        }

        if (country) filter.country = country;
        if (subscriptionType) filter.subscriptionType = subscriptionType;
        if (active !== undefined) filter.active = active === 'true';

        const tenants = await db.collection('tenants')
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        tenants.forEach(t => {
            if (t._id) t._id = t._id.toString();
        });

        return success(res, tenants);

    } catch (err) {
        console.error('❌ Search tenants error:', err);
        return error(res, err.message, 500);
    }
};