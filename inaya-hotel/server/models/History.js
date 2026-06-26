// server/models/History.js
// History/Audit Log Model - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const HISTORY_TYPES = ['request', 'booking', 'cab', 'checkin', 'checkout', 'payment', 'other'];

// ============================================================
// CRUD OPERATIONS
// ============================================================

async function createHistory(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!data.guestName || !data.type || !data.referenceId) {
            throw new Error('guestName, type, and referenceId are required');
        }

        const history = {
            hotelId,
            guestName: data.guestName.trim(),
            type: data.type,
            referenceId: data.referenceId,
            description: data.description || '',
            status: data.status || '',
            roomNumber: data.roomNumber || null,
            amount: data.amount || 0,
            performedBy: data.performedBy || 'system',
            date: data.date || new Date().toISOString(),
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('history').insertOne(history);
        history._id = result.insertedId.toString();
        return history;
    } catch (error) {
        console.error('❌ createHistory error:', error.message);
        throw error;
    }
}

async function getHistory(hotelId, options = {}) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const { guestName, type, limit = 100, page = 1 } = options;
        const filter = { hotelId };

        if (guestName) filter.guestName = { $regex: guestName, $options: 'i' };
        if (type) filter.type = type;

        const skip = (page - 1) * limit;
        const items = await db.collection('history')
            .find(filter)
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        items.forEach(h => { if (h._id) h._id = h._id.toString(); });
        return items;
    } catch (error) {
        console.error('❌ getHistory error:', error.message);
        return [];
    }
}

async function getHistoryById(hotelId, historyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(historyId)) return null;
        const db = getDB();
        if (!db) return null;

        const history = await db.collection('history').findOne({
            _id: new ObjectId(historyId),
            hotelId
        });

        if (history && history._id) history._id = history._id.toString();
        return history;
    } catch (error) {
        console.error('❌ getHistoryById error:', error.message);
        return null;
    }
}

async function getHistoryByGuest(hotelId, guestName) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const items = await db.collection('history')
            .find({ hotelId, guestName: { $regex: guestName, $options: 'i' } })
            .sort({ date: -1 })
            .toArray();

        items.forEach(h => { if (h._id) h._id = h._id.toString(); });
        return items;
    } catch (error) {
        console.error('❌ getHistoryByGuest error:', error.message);
        return [];
    }
}

async function getHistoryByReference(hotelId, referenceId) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const items = await db.collection('history')
            .find({ hotelId, referenceId })
            .sort({ date: -1 })
            .toArray();

        items.forEach(h => { if (h._id) h._id = h._id.toString(); });
        return items;
    } catch (error) {
        console.error('❌ getHistoryByReference error:', error.message);
        return [];
    }
}

async function deleteHistory(hotelId, historyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(historyId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('history').deleteOne({
            _id: new ObjectId(historyId),
            hotelId
        });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ deleteHistory error:', error.message);
        return false;
    }
}

async function deleteAllHistory(hotelId) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const result = await db.collection('history').deleteMany({ hotelId });
        return result.deletedCount;
    } catch (error) {
        console.error('❌ deleteAllHistory error:', error.message);
        return 0;
    }
}

async function getHistoryStats(hotelId) {
    try {
        if (!isConnected()) return { total: 0, byType: {} };
        const db = getDB();
        if (!db) return { total: 0, byType: {} };

        const stats = await db.collection('history').aggregate([
            { $match: { hotelId } },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    latestDate: { $max: '$date' }
                }
            }
        ]).toArray();

        const byType = {};
        let total = 0;
        stats.forEach(s => {
            byType[s._id] = { count: s.count, latestDate: s.latestDate };
            total += s.count;
        });

        return { total, byType };
    } catch (error) {
        console.error('❌ getHistoryStats error:', error.message);
        return { total: 0, byType: {} };
    }
}

async function createIndexes() {
    try {
        if (!isConnected()) return;
        const db = getDB();
        if (!db) return;

        await db.collection('history').createIndex(
            { hotelId: 1, guestName: 1, date: -1 },
            { background: true, name: 'hotelId_guestName_date_idx' }
        );
        await db.collection('history').createIndex(
            { hotelId: 1, type: 1 },
            { background: true, name: 'hotelId_type_idx' }
        );
        await db.collection('history').createIndex(
            { hotelId: 1, referenceId: 1 },
            { background: true, name: 'hotelId_referenceId_idx' }
        );

        console.log('✅ History indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    HISTORY_TYPES,
    createHistory,
    getHistory,
    getHistoryById,
    getHistoryByGuest,
    getHistoryByReference,
    deleteHistory,
    deleteAllHistory,
    getHistoryStats,
    createIndexes
};