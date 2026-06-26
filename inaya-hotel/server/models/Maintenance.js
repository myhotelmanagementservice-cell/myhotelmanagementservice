// server/models/Maintenance.js
// Maintenance Task Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const AREAS = ['Room', 'Bathroom', 'Kitchen', 'HVAC', 'Electrical', 'Plumbing', 'Pool', 'Gym', 'Lobby', 'Exterior', 'Other'];

const VALID_TRANSITIONS = {
    pending: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled', 'pending'],
    completed: [],
    cancelled: ['pending']
};

// ============================================================
// VALIDATION
// ============================================================
function validateTask(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.task || data.task.trim() === '') errors.push('Task description is required');
        if (!data.area || data.area.trim() === '') errors.push('Area is required');
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
async function createTask(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateTask(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const task = {
            hotelId,
            task: data.task.trim(),
            area: data.area.trim(),
            roomNumber: data.roomNumber || null,
            scheduled: data.scheduled ? new Date(data.scheduled) : null,
            assignedTo: data.assignedTo || '',
            priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
            status: STATUSES.includes(data.status) ? data.status : 'pending',
            notes: [],
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('maintenance').insertOne(task);
        task._id = result.insertedId.toString();
        return task;
    } catch (error) {
        console.error('❌ createTask error:', error.message);
        throw error;
    }
}

async function getTasks(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { status, priority, area, assignedTo, search, limit = 50, page = 1 } = options;
        const filter = { hotelId, isDeleted: { $ne: true } };

        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (area) filter.area = area;
        if (assignedTo) filter.assignedTo = assignedTo;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { task: searchRegex },
                { area: searchRegex },
                { assignedTo: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('maintenance')
                .find(filter)
                .sort({ 
                    priority: 1,
                    scheduled: 1,
                    createdAt: -1 
                })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('maintenance').countDocuments(filter)
        ]);

        items.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getTasks error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getTaskById(hotelId, taskId) {
    try {
        if (!isConnected() || !ObjectId.isValid(taskId)) return null;
        const db = getDB();
        if (!db) return null;

        const task = await db.collection('maintenance').findOne({
            _id: new ObjectId(taskId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (task && task._id) task._id = task._id.toString();
        return task;
    } catch (error) {
        console.error('❌ getTaskById error:', error.message);
        return null;
    }
}

async function updateTask(hotelId, taskId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(taskId)) throw new Error('Invalid task ID');

        const current = await db.collection('maintenance').findOne({
            _id: new ObjectId(taskId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!current) throw new Error('Task not found');

        // Validate status transition
        if (updates.status && updates.status !== current.status) {
            if (!isValidTransition(current.status, updates.status)) {
                throw new Error(`Invalid status transition from ${current.status} to ${updates.status}`);
            }
        }

        const updateData = { updatedAt: new Date() };

        if (updates.task) updateData.task = updates.task.trim();
        if (updates.area) updateData.area = updates.area.trim();
        if (updates.roomNumber !== undefined) updateData.roomNumber = updates.roomNumber;
        if (updates.scheduled !== undefined) {
            updateData.scheduled = updates.scheduled ? new Date(updates.scheduled) : null;
        }
        if (updates.assignedTo !== undefined) updateData.assignedTo = updates.assignedTo;
        if (updates.priority && PRIORITIES.includes(updates.priority)) {
            updateData.priority = updates.priority;
        }
        if (updates.status && STATUSES.includes(updates.status)) {
            updateData.status = updates.status;
            if (updates.status === 'completed') updateData.completedAt = new Date();
            if (updates.status === 'cancelled') updateData.cancelledAt = new Date();
        }

        const result = await db.collection('maintenance').findOneAndUpdate(
            { _id: new ObjectId(taskId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Failed to update task');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateTask error:', error.message);
        throw error;
    }
}

async function deleteTask(hotelId, taskId) {
    try {
        if (!isConnected() || !ObjectId.isValid(taskId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('maintenance').findOneAndUpdate(
            { _id: new ObjectId(taskId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteTask error:', error.message);
        return false;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================
async function startTask(hotelId, taskId, assignedTo = null) {
    const updates = { status: 'in_progress' };
    if (assignedTo) updates.assignedTo = assignedTo;
    return await updateTask(hotelId, taskId, updates);
}

async function completeTask(hotelId, taskId) {
    return await updateTask(hotelId, taskId, { status: 'completed' });
}

async function cancelTask(hotelId, taskId) {
    return await updateTask(hotelId, taskId, { status: 'cancelled' });
}

async function reopenTask(hotelId, taskId) {
    return await updateTask(hotelId, taskId, { status: 'pending' });
}

// ============================================================
// NOTES/COMMENTS
// ============================================================
async function addNote(hotelId, taskId, text, by = 'system') {
    try {
        if (!isConnected() || !ObjectId.isValid(taskId)) {
            throw new Error('Invalid task ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!text || text.trim() === '') {
            throw new Error('Note text is required');
        }

        const note = {
            text: text.trim(),
            by,
            timestamp: new Date()
        };

        const result = await db.collection('maintenance').findOneAndUpdate(
            { _id: new ObjectId(taskId), hotelId, isDeleted: { $ne: true } },
            {
                $push: { notes: note },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Task not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ addNote error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getTasksByStatus(hotelId, status) {
    try {
        if (!STATUSES.includes(status)) return [];
        const db = getDB();
        if (!db) return [];

        const tasks = await db.collection('maintenance')
            .find({ hotelId, status, isDeleted: { $ne: true } })
            .sort({ priority: 1, createdAt: -1 })
            .toArray();

        tasks.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return tasks;
    } catch (error) {
        console.error('❌ getTasksByStatus error:', error.message);
        return [];
    }
}

async function getTasksByPriority(hotelId, priority) {
    try {
        if (!PRIORITIES.includes(priority)) return [];
        const db = getDB();
        if (!db) return [];

        const tasks = await db.collection('maintenance')
            .find({ hotelId, priority, isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .toArray();

        tasks.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return tasks;
    } catch (error) {
        console.error('❌ getTasksByPriority error:', error.message);
        return [];
    }
}

async function getTasksByAssignee(hotelId, assignedTo) {
    try {
        const db = getDB();
        if (!db) return [];

        const tasks = await db.collection('maintenance')
            .find({ hotelId, assignedTo, isDeleted: { $ne: true } })
            .sort({ priority: 1, createdAt: -1 })
            .toArray();

        tasks.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return tasks;
    } catch (error) {
        console.error('❌ getTasksByAssignee error:', error.message);
        return [];
    }
}

async function getScheduledTasks(hotelId, startDate, endDate) {
    try {
        const db = getDB();
        if (!db) return [];

        const filter = {
            hotelId,
            isDeleted: { $ne: true },
            scheduled: { $ne: null }
        };

        if (startDate || endDate) {
            filter.scheduled = {};
            if (startDate) filter.scheduled.$gte = new Date(startDate);
            if (endDate) filter.scheduled.$lte = new Date(endDate);
        }

        const tasks = await db.collection('maintenance')
            .find(filter)
            .sort({ scheduled: 1 })
            .toArray();

        tasks.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return tasks;
    } catch (error) {
        console.error('❌ getScheduledTasks error:', error.message);
        return [];
    }
}

async function getOverdueTasks(hotelId) {
    try {
        const db = getDB();
        if (!db) return [];

        const now = new Date();
        const tasks = await db.collection('maintenance')
            .find({
                hotelId,
                isDeleted: { $ne: true },
                status: { $in: ['pending', 'in_progress'] },
                scheduled: { $lt: now, $ne: null }
            })
            .sort({ scheduled: 1 })
            .toArray();

        tasks.forEach(t => { if (t._id) t._id = t._id.toString(); });
        return tasks;
    } catch (error) {
        console.error('❌ getOverdueTasks error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getMaintenanceStats(hotelId) {
    try {
        if (!isConnected()) return { total: 0, byStatus: {}, byPriority: {}, overdue: 0 };
        const db = getDB();
        if (!db) return { total: 0, byStatus: {}, byPriority: {}, overdue: 0 };

        const byStatus = await db.collection('maintenance').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const byPriority = await db.collection('maintenance').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]).toArray();

        const byArea = await db.collection('maintenance').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$area', count: { $sum: 1 } } }
        ]).toArray();

        const now = new Date();
        const overdue = await db.collection('maintenance').countDocuments({
            hotelId,
            isDeleted: { $ne: true },
            status: { $in: ['pending', 'in_progress'] },
            scheduled: { $lt: now, $ne: null }
        });

        const totalResult = await db.collection('maintenance').countDocuments({
            hotelId,
            isDeleted: { $ne: true }
        });

        return {
            total: totalResult,
            overdue,
            byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byPriority: byPriority.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byArea: byArea.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {})
        };
    } catch (error) {
        console.error('❌ getMaintenanceStats error:', error.message);
        return { total: 0, byStatus: {}, byPriority: {}, byArea: {}, overdue: 0 };
    }
}

async function getTaskCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };
        if (filters.status) query.status = filters.status;
        if (filters.priority) query.priority = filters.priority;
        if (filters.area) query.area = filters.area;

        return await db.collection('maintenance').countDocuments(query);
    } catch (error) {
        console.error('❌ getTaskCount error:', error.message);
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

        await db.collection('maintenance').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('maintenance').createIndex(
            { hotelId: 1, scheduled: 1 },
            { background: true, name: 'hotelId_scheduled_idx' }
        );
        await db.collection('maintenance').createIndex(
            { hotelId: 1, priority: 1 },
            { background: true, name: 'hotelId_priority_idx' }
        );
        await db.collection('maintenance').createIndex(
            { hotelId: 1, assignedTo: 1 },
            { background: true, name: 'hotelId_assignedTo_idx' }
        );
        await db.collection('maintenance').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Maintenance indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    PRIORITIES,
    STATUSES,
    AREAS,
    VALID_TRANSITIONS,
    validateTask,
    isValidTransition,
    createTask,
    getTasks,
    getTaskById,
    updateTask,
    deleteTask,
    startTask,
    completeTask,
    cancelTask,
    reopenTask,
    addNote,
    getTasksByStatus,
    getTasksByPriority,
    getTasksByAssignee,
    getScheduledTasks,
    getOverdueTasks,
    getMaintenanceStats,
    getTaskCount,
    createIndexes
};