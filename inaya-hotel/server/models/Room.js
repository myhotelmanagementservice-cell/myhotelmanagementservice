// server/models/Room.js
// Room Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const ROOM_TYPES = ['Standard', 'Deluxe', 'Suite', 'Presidential', 'Family'];
const ROOM_STATUSES = ['Vacant', 'Occupied', 'Cleaning', 'Maintenance', 'Reserved'];

const VALID_TRANSITIONS = {
    Vacant: ['Occupied', 'Cleaning', 'Maintenance', 'Reserved'],
    Occupied: ['Cleaning', 'Vacant'],
    Cleaning: ['Vacant', 'Maintenance'],
    Maintenance: ['Cleaning', 'Vacant'],
    Reserved: ['Occupied', 'Vacant']
};

// ============================================================
// VALIDATION
// ============================================================
function validateRoom(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (data.number === undefined || data.number === null) errors.push('Room number is required');
        if (data.basePriceSAR === undefined || data.basePriceSAR === null) errors.push('Base price is required');
    }

    if (data.number !== undefined && (isNaN(data.number) || data.number <= 0)) {
        errors.push('Room number must be a positive number');
    }

    if (data.basePriceSAR !== undefined && (isNaN(data.basePriceSAR) || data.basePriceSAR < 0)) {
        errors.push('Base price must be a non-negative number');
    }

    if (data.type && !ROOM_TYPES.includes(data.type)) {
        errors.push(`Invalid room type. Must be: ${ROOM_TYPES.join(', ')}`);
    }

    if (data.status && !ROOM_STATUSES.includes(data.status)) {
        errors.push(`Invalid status. Must be: ${ROOM_STATUSES.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
}

function isValidTransition(currentStatus, newStatus) {
    return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createRoom(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateRoom(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        // Check duplicate room number
        const existing = await db.collection('rooms').findOne({
            hotelId,
            number: parseInt(data.number),
            isDeleted: { $ne: true }
        });
        if (existing) throw new Error(`Room ${data.number} already exists`);

        const room = {
            hotelId,
            number: parseInt(data.number),
            type: ROOM_TYPES.includes(data.type) ? data.type : 'Standard',
            status: ROOM_STATUSES.includes(data.status) ? data.status : 'Vacant',
            basePriceSAR: parseFloat(data.basePriceSAR),
            floor: data.floor || null,
            capacity: data.capacity || 2,
            view: data.view || '',
            size: data.size || '',
            guestName: data.guestName || '',
            amenities: Array.isArray(data.amenities) ? data.amenities : [],
            notes: data.notes || '',
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('rooms').insertOne(room);
        room._id = result.insertedId.toString();
        return room;
    } catch (error) {
        console.error('❌ createRoom error:', error.message);
        throw error;
    }
}

async function getRooms(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { type, status, floor, search, limit = 50, page = 1 } = options;
        const filter = { hotelId, isDeleted: { $ne: true } };

        if (type) filter.type = type;
        if (status) filter.status = status;
        if (floor) filter.floor = parseInt(floor);

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { guestName: searchRegex },
                { notes: searchRegex },
                { number: parseInt(search) || -1 }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('rooms')
                .find(filter)
                .sort({ number: 1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('rooms').countDocuments(filter)
        ]);

        items.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getRooms error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getRoomById(hotelId, roomId) {
    try {
        if (!isConnected() || !ObjectId.isValid(roomId)) return null;
        const db = getDB();
        if (!db) return null;

        const room = await db.collection('rooms').findOne({
            _id: new ObjectId(roomId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (room && room._id) room._id = room._id.toString();
        return room;
    } catch (error) {
        console.error('❌ getRoomById error:', error.message);
        return null;
    }
}

async function getRoomByNumber(hotelId, roomNumber) {
    try {
        if (!isConnected()) return null;
        const db = getDB();
        if (!db) return null;

        const room = await db.collection('rooms').findOne({
            hotelId,
            number: parseInt(roomNumber),
            isDeleted: { $ne: true }
        });

        if (room && room._id) room._id = room._id.toString();
        return room;
    } catch (error) {
        console.error('❌ getRoomByNumber error:', error.message);
        return null;
    }
}

async function updateRoom(hotelId, roomId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(roomId)) throw new Error('Invalid room ID');

        const current = await db.collection('rooms').findOne({
            _id: new ObjectId(roomId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (!current) throw new Error('Room not found');

        // Check duplicate room number if changing
        if (updates.number !== undefined && updates.number !== current.number) {
            const existing = await db.collection('rooms').findOne({
                hotelId,
                number: parseInt(updates.number),
                _id: { $ne: new ObjectId(roomId) },
                isDeleted: { $ne: true }
            });
            if (existing) throw new Error(`Room ${updates.number} already exists`);
        }

        // Validate status transition
        if (updates.status && updates.status !== current.status) {
            if (!isValidTransition(current.status, updates.status)) {
                throw new Error(`Invalid status transition from ${current.status} to ${updates.status}`);
            }
        }

        const updateData = { updatedAt: new Date() };

        if (updates.number !== undefined) updateData.number = parseInt(updates.number);
        if (updates.type && ROOM_TYPES.includes(updates.type)) updateData.type = updates.type;
        if (updates.status && ROOM_STATUSES.includes(updates.status)) updateData.status = updates.status;
        if (updates.basePriceSAR !== undefined) updateData.basePriceSAR = parseFloat(updates.basePriceSAR);
        if (updates.floor !== undefined) updateData.floor = updates.floor;
        if (updates.capacity !== undefined) updateData.capacity = updates.capacity;
        if (updates.view !== undefined) updateData.view = updates.view;
        if (updates.size !== undefined) updateData.size = updates.size;
        if (updates.guestName !== undefined) updateData.guestName = updates.guestName;
        if (updates.amenities !== undefined) updateData.amenities = updates.amenities;
        if (updates.notes !== undefined) updateData.notes = updates.notes;

        const result = await db.collection('rooms').findOneAndUpdate(
            { _id: new ObjectId(roomId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Failed to update room');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateRoom error:', error.message);
        throw error;
    }
}

async function deleteRoom(hotelId, roomId) {
    try {
        if (!isConnected() || !ObjectId.isValid(roomId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('rooms').findOneAndUpdate(
            { _id: new ObjectId(roomId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteRoom error:', error.message);
        return false;
    }
}

// ============================================================
// STATUS MANAGEMENT
// ============================================================
async function checkInGuest(hotelId, roomId, guestName) {
    return await updateRoom(hotelId, roomId, {
        status: 'Occupied',
        guestName
    });
}

async function checkOutGuest(hotelId, roomId) {
    return await updateRoom(hotelId, roomId, {
        status: 'Cleaning',
        guestName: ''
    });
}

async function markAsClean(hotelId, roomId) {
    return await updateRoom(hotelId, roomId, { status: 'Vacant' });
}

async function markForMaintenance(hotelId, roomId) {
    return await updateRoom(hotelId, roomId, { status: 'Maintenance' });
}

async function reserveRoom(hotelId, roomId) {
    return await updateRoom(hotelId, roomId, { status: 'Reserved' });
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getRoomsByStatus(hotelId, status) {
    try {
        if (!ROOM_STATUSES.includes(status)) return [];
        const db = getDB();
        if (!db) return [];

        const rooms = await db.collection('rooms')
            .find({ hotelId, status, isDeleted: { $ne: true } })
            .sort({ number: 1 })
            .toArray();

        rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return rooms;
    } catch (error) {
        console.error('❌ getRoomsByStatus error:', error.message);
        return [];
    }
}

async function getRoomsByType(hotelId, type) {
    try {
        if (!ROOM_TYPES.includes(type)) return [];
        const db = getDB();
        if (!db) return [];

        const rooms = await db.collection('rooms')
            .find({ hotelId, type, isDeleted: { $ne: true } })
            .sort({ number: 1 })
            .toArray();

        rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return rooms;
    } catch (error) {
        console.error('❌ getRoomsByType error:', error.message);
        return [];
    }
}

async function getAvailableRooms(hotelId, type = null) {
    try {
        const db = getDB();
        if (!db) return [];

        const filter = {
            hotelId,
            status: 'Vacant',
            isDeleted: { $ne: true }
        };
        if (type) filter.type = type;

        const rooms = await db.collection('rooms')
            .find(filter)
            .sort({ number: 1 })
            .toArray();

        rooms.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return rooms;
    } catch (error) {
        console.error('❌ getAvailableRooms error:', error.message);
        return [];
    }
}

async function getOccupiedRooms(hotelId) {
    return await getRoomsByStatus(hotelId, 'Occupied');
}

// ============================================================
// STATISTICS
// ============================================================
async function getRoomStats(hotelId) {
    try {
        if (!isConnected()) return { total: 0, byStatus: {}, byType: {}, occupancyRate: 0, avgPrice: 0 };
        const db = getDB();
        if (!db) return { total: 0, byStatus: {}, byType: {}, occupancyRate: 0, avgPrice: 0 };

        const byStatus = await db.collection('rooms').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const byType = await db.collection('rooms').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    avgPrice: { $avg: '$basePriceSAR' }
                }
            }
        ]).toArray();

        const totals = await db.collection('rooms').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    occupied: { $sum: { $cond: [{ $eq: ['$status', 'Occupied'] }, 1, 0] } },
                    vacant: { $sum: { $cond: [{ $eq: ['$status', 'Vacant'] }, 1, 0] } },
                    avgPrice: { $avg: '$basePriceSAR' }
                }
            }
        ]).toArray();

        const result = totals[0] || { total: 0, occupied: 0, vacant: 0, avgPrice: 0 };
        const occupancyRate = result.total > 0 
            ? ((result.occupied / result.total) * 100).toFixed(1)
            : 0;

        return {
            total: result.total,
            occupied: result.occupied,
            vacant: result.vacant,
            occupancyRate,
            avgPrice: result.avgPrice ? result.avgPrice.toFixed(2) : 0,
            byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
            byType: byType.reduce((acc, s) => {
                acc[s._id] = { count: s.count, avgPrice: s.avgPrice ? s.avgPrice.toFixed(2) : 0 };
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('❌ getRoomStats error:', error.message);
        return { total: 0, byStatus: {}, byType: {}, occupancyRate: 0, avgPrice: 0 };
    }
}

async function getRoomCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };
        if (filters.status) query.status = filters.status;
        if (filters.type) query.type = filters.type;

        return await db.collection('rooms').countDocuments(query);
    } catch (error) {
        console.error('❌ getRoomCount error:', error.message);
        return 0;
    }
}

// ============================================================
// BULK OPERATIONS
// ============================================================
async function bulkCreateRooms(hotelId, roomsData) {
    try {
        if (!Array.isArray(roomsData) || roomsData.length === 0) {
            throw new Error('roomsData must be a non-empty array');
        }

        let created = 0, failed = 0;
        const errors = [];

        for (const roomData of roomsData) {
            try {
                await createRoom(hotelId, roomData);
                created++;
            } catch (error) {
                failed++;
                errors.push(`Room ${roomData.number || 'Unknown'}: ${error.message}`);
            }
        }

        return { created, failed, errors };
    } catch (error) {
        console.error('❌ bulkCreateRooms error:', error.message);
        throw error;
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

        await db.collection('rooms').createIndex(
            { hotelId: 1, number: 1 },
            { unique: true, background: true, name: 'hotelId_number_unique' }
        );
        await db.collection('rooms').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('rooms').createIndex(
            { hotelId: 1, type: 1 },
            { background: true, name: 'hotelId_type_idx' }
        );
        await db.collection('rooms').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Room indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    ROOM_TYPES,
    ROOM_STATUSES,
    VALID_TRANSITIONS,
    validateRoom,
    isValidTransition,
    createRoom,
    getRooms,
    getRoomById,
    getRoomByNumber,
    updateRoom,
    deleteRoom,
    checkInGuest,
    checkOutGuest,
    markAsClean,
    markForMaintenance,
    reserveRoom,
    getRoomsByStatus,
    getRoomsByType,
    getAvailableRooms,
    getOccupiedRooms,
    getRoomStats,
    getRoomCount,
    bulkCreateRooms,
    createIndexes
};