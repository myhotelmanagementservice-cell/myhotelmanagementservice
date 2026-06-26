// server/models/Reports.js
// Report Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const REPORT_TYPES = ['bookings', 'requests', 'guests', 'rooms', 'revenue', 'inventory', 'staff', 'custom'];

// ============================================================
// VALIDATION
// ============================================================
function validateReport(data) {
    const errors = [];

    if (!data.type || !REPORT_TYPES.includes(data.type)) {
        errors.push(`Invalid type. Must be: ${REPORT_TYPES.join(', ')}`);
    }
    if (!data.from) errors.push('From date is required');
    if (!data.to) errors.push('To date is required');

    if (data.from && data.to) {
        const fromDate = new Date(data.from);
        const toDate = new Date(data.to);
        if (toDate < fromDate) {
            errors.push('To date must be after from date');
        }
    }

    return { valid: errors.length === 0, errors };
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createReport(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateReport(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const report = {
            hotelId,
            type: data.type,
            title: data.title || `${data.type} Report`,
            from: new Date(data.from),
            to: new Date(data.to),
            data: data.data || [],
            summary: data.summary || {},
            total: data.total || 0,
            generatedAt: new Date(),
            generatedBy: data.user || 'System',
            format: data.format || 'json',
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('reports').insertOne(report);
        report._id = result.insertedId.toString();
        return report;
    } catch (error) {
        console.error('❌ createReport error:', error.message);
        throw error;
    }
}

async function getReports(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { type, limit = 50, page = 1 } = options;
        const filter = { hotelId };

        if (type) filter.type = type;

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('reports')
                .find(filter)
                .sort({ generatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('reports').countDocuments(filter)
        ]);

        items.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getReports error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getReportById(hotelId, reportId) {
    try {
        if (!isConnected() || !ObjectId.isValid(reportId)) return null;
        const db = getDB();
        if (!db) return null;

        const report = await db.collection('reports').findOne({
            _id: new ObjectId(reportId),
            hotelId
        });

        if (report && report._id) report._id = report._id.toString();
        return report;
    } catch (error) {
        console.error('❌ getReportById error:', error.message);
        return null;
    }
}

async function deleteReport(hotelId, reportId) {
    try {
        if (!isConnected() || !ObjectId.isValid(reportId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('reports').deleteOne({
            _id: new ObjectId(reportId),
            hotelId
        });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ deleteReport error:', error.message);
        return false;
    }
}

// ============================================================
// REPORT GENERATION HELPERS
// ============================================================
async function generateBookingReport(db, hotelId, fromDate, toDate) {
    try {
        const bookings = await db.collection('bookings').aggregate([
            {
                $match: {
                    hotelId,
                    createdAt: { $gte: new Date(fromDate), $lte: new Date(toDate) }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' },
                    avgPrice: { $avg: '$totalPrice' },
                    byStatus: { $push: '$status' }
                }
            }
        ]).toArray();

        const result = bookings[0] || { total: 0, revenue: 0, avgPrice: 0, byStatus: [] };

        const statusCount = {};
        result.byStatus.forEach(s => { statusCount[s] = (statusCount[s] || 0) + 1; });

        return {
            total: result.total,
            revenue: result.revenue,
            avgPrice: result.avgPrice ? result.avgPrice.toFixed(2) : 0,
            byStatus: statusCount
        };
    } catch (error) {
        console.error('❌ generateBookingReport error:', error.message);
        return { total: 0, revenue: 0, avgPrice: 0, byStatus: {} };
    }
}

async function generateRevenueReport(db, hotelId, fromDate, toDate) {
    try {
        const bySource = await db.collection('bookings').aggregate([
            {
                $match: {
                    hotelId,
                    createdAt: { $gte: new Date(fromDate), $lte: new Date(toDate) },
                    paymentStatus: 'paid'
                }
            },
            {
                $group: {
                    _id: '$source',
                    total: { $sum: '$totalPrice' },
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const byPaymentMethod = await db.collection('bookings').aggregate([
            {
                $match: {
                    hotelId,
                    createdAt: { $gte: new Date(fromDate), $lte: new Date(toDate) },
                    paymentStatus: 'paid'
                }
            },
            {
                $group: {
                    _id: '$paymentMethod',
                    total: { $sum: '$totalPrice' },
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const totalRevenue = bySource.reduce((sum, s) => sum + s.total, 0);

        return {
            totalRevenue,
            bySource: bySource.reduce((acc, s) => {
                acc[s._id] = { total: s.total, count: s.count };
                return acc;
            }, {}),
            byPaymentMethod: byPaymentMethod.reduce((acc, s) => {
                acc[s._id || 'unknown'] = { total: s.total, count: s.count };
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('❌ generateRevenueReport error:', error.message);
        return { totalRevenue: 0, bySource: {}, byPaymentMethod: {} };
    }
}

async function generateGuestReport(db, hotelId, fromDate, toDate) {
    try {
        const stats = await db.collection('guests').aggregate([
            {
                $match: {
                    hotelId,
                    createdAt: { $gte: new Date(fromDate), $lte: new Date(toDate) }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    avgPoints: { $avg: '$points' },
                    vipCount: { $sum: { $cond: ['$isVIP', 1, 0] } }
                }
            }
        ]).toArray();

        const result = stats[0] || { total: 0, avgPoints: 0, vipCount: 0 };

        return {
            total: result.total,
            avgPoints: result.avgPoints ? result.avgPoints.toFixed(2) : 0,
            vipCount: result.vipCount
        };
    } catch (error) {
        console.error('❌ generateGuestReport error:', error.message);
        return { total: 0, avgPoints: 0, vipCount: 0 };
    }
}

async function generateRoomReport(db, hotelId, fromDate, toDate) {
    try {
        const stats = await db.collection('rooms').aggregate([
            { $match: { hotelId } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    byStatus: { $push: '$status' },
                    byType: { $push: '$type' }
                }
            }
        ]).toArray();

        const result = stats[0] || { total: 0, byStatus: [], byType: [] };

        const statusCount = {};
        result.byStatus.forEach(s => { statusCount[s] = (statusCount[s] || 0) + 1; });

        const typeCount = {};
        result.byType.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });

        return {
            total: result.total,
            byStatus: statusCount,
            byType: typeCount
        };
    } catch (error) {
        console.error('❌ generateRoomReport error:', error.message);
        return { total: 0, byStatus: {}, byType: {} };
    }
}

async function generateRequestReport(db, hotelId, fromDate, toDate) {
    try {
        const stats = await db.collection('requests').aggregate([
            {
                $match: {
                    hotelId,
                    createdAt: { $gte: new Date(fromDate), $lte: new Date(toDate) }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    byStatus: { $push: '$status' },
                    byType: { $push: '$type' },
                    avgResponseTime: { $avg: '$responseTime' }
                }
            }
        ]).toArray();

        const result = stats[0] || { total: 0, byStatus: [], byType: [], avgResponseTime: 0 };

        const statusCount = {};
        result.byStatus.forEach(s => { statusCount[s] = (statusCount[s] || 0) + 1; });

        const typeCount = {};
        result.byType.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });

        return {
            total: result.total,
            byStatus: statusCount,
            byType: typeCount,
            avgResponseTime: result.avgResponseTime ? result.avgResponseTime.toFixed(2) : 0
        };
    } catch (error) {
        console.error('❌ generateRequestReport error:', error.message);
        return { total: 0, byStatus: {}, byType: {}, avgResponseTime: 0 };
    }
}

// ============================================================
// GENERATE & SAVE REPORT
// ============================================================
async function generateAndSaveReport(hotelId, type, fromDate, toDate, user = 'System') {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        let data = {};
        let total = 0;
        let summary = {};

        switch (type) {
            case 'bookings':
                data = await generateBookingReport(db, hotelId, fromDate, toDate);
                total = data.total;
                summary = { revenue: data.revenue, avgPrice: data.avgPrice };
                break;
            case 'revenue':
                data = await generateRevenueReport(db, hotelId, fromDate, toDate);
                total = data.totalRevenue;
                summary = { bySource: data.bySource };
                break;
            case 'guests':
                data = await generateGuestReport(db, hotelId, fromDate, toDate);
                total = data.total;
                summary = { avgPoints: data.avgPoints, vipCount: data.vipCount };
                break;
            case 'rooms':
                data = await generateRoomReport(db, hotelId, fromDate, toDate);
                total = data.total;
                summary = { byStatus: data.byStatus, byType: data.byType };
                break;
            case 'requests':
                data = await generateRequestReport(db, hotelId, fromDate, toDate);
                total = data.total;
                summary = { avgResponseTime: data.avgResponseTime };
                break;
            default:
                throw new Error(`Report type "${type}" not supported for auto-generation`);
        }

        return await createReport(hotelId, {
            type,
            title: `${type.charAt(0).toUpperCase() + type.slice(1)} Report`,
            from: fromDate,
            to: toDate,
            data,
            summary,
            total,
            user
        });
    } catch (error) {
        console.error('❌ generateAndSaveReport error:', error.message);
        throw error;
    }
}

// ============================================================
// EXPORT
// ============================================================
async function exportReport(hotelId, reportId, format = 'json') {
    try {
        const report = await getReportById(hotelId, reportId);
        if (!report) throw new Error('Report not found');

        if (format === 'csv') {
            const headers = ['Field', 'Value'];
            const rows = [
                ['Type', report.type],
                ['From', report.from],
                ['To', report.to],
                ['Total', report.total],
                ['Generated At', report.generatedAt]
            ];

            // Add summary data
            if (report.summary) {
                Object.entries(report.summary).forEach(([key, value]) => {
                    rows.push([key, typeof value === 'object' ? JSON.stringify(value) : value]);
                });
            }

            return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        }

        return report;
    } catch (error) {
        console.error('❌ exportReport error:', error.message);
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

        await db.collection('reports').createIndex(
            { hotelId: 1, type: 1 },
            { background: true, name: 'hotelId_type_idx' }
        );
        await db.collection('reports').createIndex(
            { hotelId: 1, generatedAt: -1 },
            { background: true, name: 'hotelId_generatedAt_idx' }
        );
        await db.collection('reports').createIndex(
            { hotelId: 1, from: 1, to: 1 },
            { background: true, name: 'hotelId_dates_idx' }
        );

        console.log('✅ Reports indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    REPORT_TYPES,
    validateReport,
    createReport,
    getReports,
    getReportById,
    deleteReport,
    generateBookingReport,
    generateRevenueReport,
    generateGuestReport,
    generateRoomReport,
    generateRequestReport,
    generateAndSaveReport,
    exportReport,
    createIndexes
};