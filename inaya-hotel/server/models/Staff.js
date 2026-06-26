// server/models/Staff.js
// Staff Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const STAFF_STATUS = ['online', 'offline', 'on-duty', 'on-leave', 'inactive'];
const SHIFTS = ['morning', 'evening', 'night'];
const ATTENDANCE = ['present', 'absent', 'half-day'];
const LEAVE_STATUS = ['pending', 'approved', 'rejected'];

// ============================================================
// VALIDATION
// ============================================================
function validateStaff(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.name || data.name.trim() === '') errors.push('Name is required');
        if (!data.role || data.role.trim() === '') errors.push('Role is required');
    }

    if (data.status && !STAFF_STATUS.includes(data.status)) {
        errors.push(`Invalid status. Must be: ${STAFF_STATUS.join(', ')}`);
    }

    if (data.shift && !SHIFTS.includes(data.shift)) {
        errors.push(`Invalid shift. Must be: ${SHIFTS.join(', ')}`);
    }

    if (data.attendance && !ATTENDANCE.includes(data.attendance)) {
        errors.push(`Invalid attendance. Must be: ${ATTENDANCE.join(', ')}`);
    }

    if (data.rating !== undefined && (isNaN(data.rating) || data.rating < 0 || data.rating > 5)) {
        errors.push('Rating must be between 0 and 5');
    }

    return { valid: errors.length === 0, errors };
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createStaff(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateStaff(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const staff = {
            hotelId,
            name: data.name.trim(),
            role: data.role.trim(),
            department: data.department || 'General',
            email: data.email ? data.email.toLowerCase().trim() : null,
            phone: data.phone || '',
            joinDate: data.joinDate ? new Date(data.joinDate) : new Date(),
            status: STAFF_STATUS.includes(data.status) ? data.status : 'online',
            shift: SHIFTS.includes(data.shift) ? data.shift : 'morning',
            attendance: ATTENDANCE.includes(data.attendance) ? data.attendance : 'present',
            rating: data.rating !== undefined ? parseFloat(data.rating) : 5.0,
            tasks: parseInt(data.tasks) || 0,
            leaveRequest: data.leaveRequest || {
                reason: '',
                date: null,
                status: 'pending'
            },
            notes: data.notes || '',
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('staff').insertOne(staff);
        staff._id = result.insertedId.toString();
        return staff;
    } catch (error) {
        console.error('❌ createStaff error:', error.message);
        throw error;
    }
}

async function getStaff(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { department, status, shift, attendance, search, limit = 50, page = 1 } = options;
        const filter = { hotelId, isDeleted: { $ne: true } };

        if (department) filter.department = department;
        if (status) filter.status = status;
        if (shift) filter.shift = shift;
        if (attendance) filter.attendance = attendance;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { name: searchRegex },
                { role: searchRegex },
                { email: searchRegex },
                { phone: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('staff')
                .find(filter)
                .sort({ name: 1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('staff').countDocuments(filter)
        ]);

        items.forEach(s => { if (s._id) s._id = s._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getStaff error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getStaffById(hotelId, staffId) {
    try {
        if (!isConnected() || !ObjectId.isValid(staffId)) return null;
        const db = getDB();
        if (!db) return null;

        const staff = await db.collection('staff').findOne({
            _id: new ObjectId(staffId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (staff && staff._id) staff._id = staff._id.toString();
        return staff;
    } catch (error) {
        console.error('❌ getStaffById error:', error.message);
        return null;
    }
}

async function updateStaff(hotelId, staffId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(staffId)) throw new Error('Invalid staff ID');

        const validation = validateStaff(updates, true);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const updateData = { updatedAt: new Date() };

        if (updates.name) updateData.name = updates.name.trim();
        if (updates.role) updateData.role = updates.role.trim();
        if (updates.department) updateData.department = updates.department;
        if (updates.email !== undefined) {
            updateData.email = updates.email ? updates.email.toLowerCase().trim() : null;
        }
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.joinDate) updateData.joinDate = new Date(updates.joinDate);
        if (updates.status && STAFF_STATUS.includes(updates.status)) updateData.status = updates.status;
        if (updates.shift && SHIFTS.includes(updates.shift)) updateData.shift = updates.shift;
        if (updates.attendance && ATTENDANCE.includes(updates.attendance)) updateData.attendance = updates.attendance;
        if (updates.rating !== undefined) updateData.rating = parseFloat(updates.rating);
        if (updates.tasks !== undefined) updateData.tasks = parseInt(updates.tasks);
        if (updates.leaveRequest) updateData.leaveRequest = updates.leaveRequest;
        if (updates.notes !== undefined) updateData.notes = updates.notes;

        const result = await db.collection('staff').findOneAndUpdate(
            { _id: new ObjectId(staffId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Staff not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateStaff error:', error.message);
        throw error;
    }
}

async function deleteStaff(hotelId, staffId) {
    try {
        if (!isConnected() || !ObjectId.isValid(staffId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('staff').findOneAndUpdate(
            { _id: new ObjectId(staffId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteStaff error:', error.message);
        return false;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================
async function setStatus(hotelId, staffId, status) {
    if (!STAFF_STATUS.includes(status)) throw new Error(`Invalid status: ${status}`);
    return await updateStaff(hotelId, staffId, { status });
}

async function setShift(hotelId, staffId, shift) {
    if (!SHIFTS.includes(shift)) throw new Error(`Invalid shift: ${shift}`);
    return await updateStaff(hotelId, staffId, { shift });
}

async function setAttendance(hotelId, staffId, attendance) {
    if (!ATTENDANCE.includes(attendance)) throw new Error(`Invalid attendance: ${attendance}`);
    return await updateStaff(hotelId, staffId, { attendance });
}

async function markOnline(hotelId, staffId) {
    return await setStatus(hotelId, staffId, 'online');
}

async function markOffline(hotelId, staffId) {
    return await setStatus(hotelId, staffId, 'offline');
}

async function markOnDuty(hotelId, staffId) {
    return await setStatus(hotelId, staffId, 'on-duty');
}

// ============================================================
// LEAVE MANAGEMENT
// ============================================================
async function requestLeave(hotelId, staffId, reason, date) {
    try {
        return await updateStaff(hotelId, staffId, {
            leaveRequest: {
                reason,
                date: date ? new Date(date) : new Date(),
                status: 'pending'
            }
        });
    } catch (error) {
        console.error('❌ requestLeave error:', error.message);
        throw error;
    }
}

async function approveLeave(hotelId, staffId) {
    try {
        const staff = await getStaffById(hotelId, staffId);
        if (!staff) throw new Error('Staff not found');

        return await updateStaff(hotelId, staffId, {
            leaveRequest: { ...staff.leaveRequest, status: 'approved' },
            status: 'on-leave'
        });
    } catch (error) {
        console.error('❌ approveLeave error:', error.message);
        throw error;
    }
}

async function rejectLeave(hotelId, staffId) {
    try {
        const staff = await getStaffById(hotelId, staffId);
        if (!staff) throw new Error('Staff not found');

        return await updateStaff(hotelId, staffId, {
            leaveRequest: { ...staff.leaveRequest, status: 'rejected' }
        });
    } catch (error) {
        console.error('❌ rejectLeave error:', error.message);
        throw error;
    }
}

// ============================================================
// RATING & TASKS
// ============================================================
async function updateRating(hotelId, staffId, rating) {
    if (rating < 0 || rating > 5) throw new Error('Rating must be between 0 and 5');
    return await updateStaff(hotelId, staffId, { rating: parseFloat(rating) });
}

async function incrementTasks(hotelId, staffId, count = 1) {
    try {
        if (!isConnected() || !ObjectId.isValid(staffId)) {
            throw new Error('Invalid staff ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const result = await db.collection('staff').findOneAndUpdate(
            { _id: new ObjectId(staffId), hotelId, isDeleted: { $ne: true } },
            { 
                $inc: { tasks: count },
                $set: { updatedAt: new Date() },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Staff not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ incrementTasks error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getStaffByDepartment(hotelId, department) {
    try {
        const db = getDB();
        if (!db) return [];

        const staff = await db.collection('staff')
            .find({ hotelId, department, isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        staff.forEach(s => { if (s._id) s._id = s._id.toString(); });
        return staff;
    } catch (error) {
        console.error('❌ getStaffByDepartment error:', error.message);
        return [];
    }
}

async function getStaffByStatus(hotelId, status) {
    try {
        if (!STAFF_STATUS.includes(status)) return [];
        const db = getDB();
        if (!db) return [];

        const staff = await db.collection('staff')
            .find({ hotelId, status, isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        staff.forEach(s => { if (s._id) s._id = s._id.toString(); });
        return staff;
    } catch (error) {
        console.error('❌ getStaffByStatus error:', error.message);
        return [];
    }
}

async function getStaffByShift(hotelId, shift) {
    try {
        if (!SHIFTS.includes(shift)) return [];
        const db = getDB();
        if (!db) return [];

        const staff = await db.collection('staff')
            .find({ hotelId, shift, isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .toArray();

        staff.forEach(s => { if (s._id) s._id = s._id.toString(); });
        return staff;
    } catch (error) {
        console.error('❌ getStaffByShift error:', error.message);
        return [];
    }
}

async function getOnlineStaff(hotelId) {
    return await getStaffByStatus(hotelId, 'online');
}

async function getOnDutyStaff(hotelId) {
    return await getStaffByStatus(hotelId, 'on-duty');
}

async function getDepartments(hotelId) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const departments = await db.collection('staff')
            .distinct('department', { hotelId, isDeleted: { $ne: true } });

        return departments.sort();
    } catch (error) {
        console.error('❌ getDepartments error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getStaffStats(hotelId) {
    try {
        if (!isConnected()) return { total: 0, byStatus: {}, byDepartment: {}, byShift: {}, avgRating: 0, totalTasks: 0 };
        const db = getDB();
        if (!db) return { total: 0, byStatus: {}, byDepartment: {}, byShift: {}, avgRating: 0, totalTasks: 0 };

        const byStatus = await db.collection('staff').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const byDepartment = await db.collection('staff').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$department', count: { $sum: 1 } } }
        ]).toArray();

        const byShift = await db.collection('staff').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$shift', count: { $sum: 1 } } }
        ]).toArray();

        const totals = await db.collection('staff').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    avgRating: { $avg: '$rating' },
                    totalTasks: { $sum: '$tasks' }
                }
            }
        ]).toArray();

        const result = totals[0] || { total: 0, avgRating: 0, totalTasks: 0 };

        return {
            total: result.total,
            avgRating: result.avgRating ? result.avgRating.toFixed(1) : 0,
            totalTasks: result.totalTasks,
            byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byDepartment: byDepartment.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byShift: byShift.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {})
        };
    } catch (error) {
        console.error('❌ getStaffStats error:', error.message);
        return { total: 0, byStatus: {}, byDepartment: {}, byShift: {}, avgRating: 0, totalTasks: 0 };
    }
}

async function getStaffCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };
        if (filters.status) query.status = filters.status;
        if (filters.department) query.department = filters.department;
        if (filters.shift) query.shift = filters.shift;

        return await db.collection('staff').countDocuments(query);
    } catch (error) {
        console.error('❌ getStaffCount error:', error.message);
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

        await db.collection('staff').createIndex(
            { hotelId: 1, department: 1 },
            { background: true, name: 'hotelId_department_idx' }
        );
        await db.collection('staff').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('staff').createIndex(
            { hotelId: 1, shift: 1 },
            { background: true, name: 'hotelId_shift_idx' }
        );
        await db.collection('staff').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Staff indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    STAFF_STATUS,
    SHIFTS,
    ATTENDANCE,
    LEAVE_STATUS,
    validateStaff,
    createStaff,
    getStaff,
    getStaffById,
    updateStaff,
    deleteStaff,
    setStatus,
    setShift,
    setAttendance,
    markOnline,
    markOffline,
    markOnDuty,
    requestLeave,
    approveLeave,
    rejectLeave,
    updateRating,
    incrementTasks,
    getStaffByDepartment,
    getStaffByStatus,
    getStaffByShift,
    getOnlineStaff,
    getOnDutyStaff,
    getDepartments,
    getStaffStats,
    getStaffCount,
    createIndexes
};