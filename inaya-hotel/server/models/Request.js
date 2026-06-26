// server/models/Request.js
// Guest Request Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const PRIORITIES = ['low', 'normal', 'urgent', 'emergency'];
const STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
const DEPARTMENTS = ['housekeeping', 'maintenance', 'food', 'front-desk', 'security', 'other'];

const VALID_TRANSITIONS = {
    open: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled', 'open'],
    completed: ['open'],
    cancelled: ['open']
};

// ============================================================
// VALIDATION
// ============================================================
function validateRequest(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.guestName || data.guestName.trim() === '') errors.push('Guest name is required');
        if (data.roomNumber === undefined || data.roomNumber === null) errors.push('Room number is required');
        if (!data.department || !DEPARTMENTS.includes(data.department)) {
            errors.push(`Invalid department. Must be: ${DEPARTMENTS.join(', ')}`);
        }
        if (!data.description || data.description.trim() === '') errors.push('Description is required');
    }

    if (data.priority && !PRIORITIES.includes(data.priority)) {
        errors.push(`Invalid priority. Must be: ${PRIORITIES.join(', ')}`);
    }

    if (data.status && !STATUSES.includes(data.status)) {
        errors.push(`Invalid status. Must be: ${STATUSES.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
}

function isValidTransition(currentStatus, newStatus) {
    return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createRequest(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateRequest(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const request = {
            hotelId,
            guestName: data.guestName.trim(),
            roomNumber: parseInt(data.roomNumber),
            department: data.department,
            category: data.category || 'General',
            description: data.description.trim(),
            priority: PRIORITIES.includes(data.priority) ? data.priority : 'normal',
            status: 'open',
            assignedTo: data.assignedTo || '',
            adminReply: '',
            adminReplyTime: null,
            completedAt: null,
            cancelledAt: null,
            responseTime: null,
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('requests').insertOne(request);
        request._id = result.insertedId.toString();
        return request;
    } catch (error) {
        console.error('❌ createRequest error:', error.message);
        throw error;
    }
}

async function getRequests(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { status, department, priority, roomNumber, search, limit = 50, page = 1 } = options;
        const filter = { hotelId, isDeleted: { $ne: true } };

        if (status) filter.status = status;
        if (department) filter.department = department;
        if (priority) filter.priority = priority;
        if (roomNumber) filter.roomNumber = parseInt(roomNumber);

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { guestName: searchRegex },
                { description: searchRegex },
                { category: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('requests')
                .find(filter)
                .sort({ 
                    priority: 1,
                    createdAt: -1 
                })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('requests').countDocuments(filter)
        ]);

        items.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getRequests error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getRequestById(hotelId, requestId) {
    try {
        if (!isConnected() || !ObjectId.isValid(requestId)) return null;
        const db = getDB();
        if (!db) return null;

        const request = await db.collection('requests').findOne({
            _id: new ObjectId(requestId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (request && request._id) request._id = request._id.toString();
        return request;
    } catch (error) {
        console.error('❌ getRequestById error:', error.message);
        return null;
    }
}

async function updateRequest(hotelId, requestId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(requestId)) throw new Error('Invalid request ID');

        const current = await db.collection('requests').findOne({
            _id: new ObjectId(requestId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!current) throw new Error('Request not found');

        // Validate status transition
        if (updates.status && updates.status !== current.status) {
            if (!isValidTransition(current.status, updates.status)) {
                throw new Error(`Invalid status transition from ${current.status} to ${updates.status}`);
            }
        }

        const updateData = { updatedAt: new Date() };

        if (updates.guestName) updateData.guestName = updates.guestName.trim();
        if (updates.roomNumber !== undefined) updateData.roomNumber = parseInt(updates.roomNumber);
        if (updates.department && DEPARTMENTS.includes(updates.department)) updateData.department = updates.department;
        if (updates.category) updateData.category = updates.category;
        if (updates.description) updateData.description = updates.description.trim();
        if (updates.priority && PRIORITIES.includes(updates.priority)) updateData.priority = updates.priority;
        if (updates.assignedTo !== undefined) updateData.assignedTo = updates.assignedTo;

        if (updates.status && STATUSES.includes(updates.status)) {
            updateData.status = updates.status;
            if (updates.status === 'completed') updateData.completedAt = new Date();
            if (updates.status === 'cancelled') updateData.cancelledAt = new Date();
        }

        const result = await db.collection('requests').findOneAndUpdate(
            { _id: new ObjectId(requestId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Failed to update request');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateRequest error:', error.message);
        throw error;
    }
}

async function deleteRequest(hotelId, requestId) {
    try {
        if (!isConnected() || !ObjectId.isValid(requestId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('requests').findOneAndUpdate(
            { _id: new ObjectId(requestId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteRequest error:', error.message);
        return false;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================
async function startRequest(hotelId, requestId, assignedTo = null) {
    const updates = { status: 'in_progress' };
    if (assignedTo) updates.assignedTo = assignedTo;
    return await updateRequest(hotelId, requestId, updates);
}

async function completeRequest(hotelId, requestId, adminReply = '') {
    const updates = { status: 'completed' };
    if (adminReply) {
        updates.adminReply = adminReply;
        updates.adminReplyTime = new Date();

        // Calculate response time
        const request = await getRequestById(hotelId, requestId);
        if (request) {
            const responseTime = Date.now() - new Date(request.createdAt).getTime();
            updates.responseTime = responseTime;
        }
    }
    return await updateRequest(hotelId, requestId, updates);
}

async function cancelRequest(hotelId, requestId) {
    return await updateRequest(hotelId, requestId, { status: 'cancelled' });
}

async function reopenRequest(hotelId, requestId) {
    return await updateRequest(hotelId, requestId, { status: 'open' });
}

async function addAdminReply(hotelId, requestId, reply) {
    try {
        if (!isConnected() || !ObjectId.isValid(requestId)) {
            throw new Error('Invalid request ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const request = await db.collection('requests').findOne({
            _id: new ObjectId(requestId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!request) throw new Error('Request not found');

        const responseTime = Date.now() - new Date(request.createdAt).getTime();

        const result = await db.collection('requests').findOneAndUpdate(
            { _id: new ObjectId(requestId), hotelId },
            {
                $set: {
                    adminReply: reply,
                    adminReplyTime: new Date(),
                    responseTime,
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ addAdminReply error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getRequestsByStatus(hotelId, status) {
    try {
        if (!STATUSES.includes(status)) return [];
        const db = getDB();
        if (!db) return [];

        const requests = await db.collection('requests')
            .find({ hotelId, status, isDeleted: { $ne: true } })
            .sort({ priority: 1, createdAt: -1 })
            .toArray();

        requests.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return requests;
    } catch (error) {
        console.error('❌ getRequestsByStatus error:', error.message);
        return [];
    }
}

async function getRequestsByDepartment(hotelId, department) {
    try {
        if (!DEPARTMENTS.includes(department)) return [];
        const db = getDB();
        if (!db) return [];

        const requests = await db.collection('requests')
            .find({ hotelId, department, isDeleted: { $ne: true } })
            .sort({ priority: 1, createdAt: -1 })
            .toArray();

        requests.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return requests;
    } catch (error) {
        console.error('❌ getRequestsByDepartment error:', error.message);
        return [];
    }
}

async function getRequestsByRoom(hotelId, roomNumber) {
    try {
        const db = getDB();
        if (!db) return [];

        const requests = await db.collection('requests')
            .find({ hotelId, roomNumber: parseInt(roomNumber), isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .toArray();

        requests.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return requests;
    } catch (error) {
        console.error('❌ getRequestsByRoom error:', error.message);
        return [];
    }
}

async function getOpenRequests(hotelId) {
    return await getRequestsByStatus(hotelId, 'open');
}

async function getUrgentRequests(hotelId) {
    try {
        const db = getDB();
        if (!db) return [];

        const requests = await db.collection('requests')
            .find({
                hotelId,
                priority: { $in: ['urgent', 'emergency'] },
                status: { $in: ['open', 'in_progress'] },
                isDeleted: { $ne: true }
            })
            .sort({ priority: 1, createdAt: -1 })
            .toArray();

        requests.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return requests;
    } catch (error) {
        console.error('❌ getUrgentRequests error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getRequestStats(hotelId) {
    try {
        if (!isConnected()) return { total: 0, byStatus: {}, byDepartment: {}, byPriority: {}, avgResponseTime: 0 };
        const db = getDB();
        if (!db) return { total: 0, byStatus: {}, byDepartment: {}, byPriority: {}, avgResponseTime: 0 };

        const byStatus = await db.collection('requests').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const byDepartment = await db.collection('requests').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$department', count: { $sum: 1 } } }
        ]).toArray();

        const byPriority = await db.collection('requests').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]).toArray();

        const avgResponse = await db.collection('requests').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true }, responseTime: { $exists: true, $ne: null } } },
            { $group: { _id: null, avgResponseTime: { $avg: '$responseTime' } } }
        ]).toArray();

        const totalResult = await db.collection('requests').countDocuments({
            hotelId,
            isDeleted: { $ne: true }
        });

        return {
            total: totalResult,
            byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byDepartment: byDepartment.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byPriority: byPriority.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            avgResponseTime: avgResponse[0]?.avgResponseTime ? (avgResponse[0].avgResponseTime / 1000 / 60).toFixed(2) : 0
        };
    } catch (error) {
        console.error('❌ getRequestStats error:', error.message);
        return { total: 0, byStatus: {}, byDepartment: {}, byPriority: {}, avgResponseTime: 0 };
    }
}

async function getRequestCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };
        if (filters.status) query.status = filters.status;
        if (filters.department) query.department = filters.department;
        if (filters.priority) query.priority = filters.priority;

        return await db.collection('requests').countDocuments(query);
    } catch (error) {
        console.error('❌ getRequestCount error:', error.message);
        return 0;
    }
}

// ============================================================
// INDEXES
// ============================================================
async function createIndexes() {
    try {
        if (!isConnected()) return;
        const db = getDB();
        if (!db) return;

        await db.collection('requests').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('requests').createIndex(
            { hotelId: 1, department: 1 },
            { background: true, name: 'hotelId_department_idx' }
        );
        await db.collection('requests').createIndex(
            { hotelId: 1, createdAt: -1 },
            { background: true, name: 'hotelId_createdAt_idx' }
        );
        await db.collection('requests').createIndex(
            { hotelId: 1, priority: 1 },
            { background: true, name: 'hotelId_priority_idx' }
        );
        await db.collection('requests').createIndex(
            { hotelId: 1, roomNumber: 1 },
            { background: true, name: 'hotelId_roomNumber_idx' }
        );
        await db.collection('requests').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Request indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    PRIORITIES,
    STATUSES,
    DEPARTMENTS,
    VALID_TRANSITIONS,
    validateRequest,
    isValidTransition,
    createRequest,
    getRequests,
    getRequestById,
    updateRequest,
    deleteRequest,
    startRequest,
    completeRequest,
    cancelRequest,
    reopenRequest,
    addAdminReply,
    getRequestsByStatus,
    getRequestsByDepartment,
    getRequestsByRoom,
    getOpenRequests,
    getUrgentRequests,
    getRequestStats,
    getRequestCount,
    createIndexes
};