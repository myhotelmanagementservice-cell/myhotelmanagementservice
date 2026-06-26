// server/models/Review.js
// Guest Review Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const RATING_MIN = 1;
const RATING_MAX = 5;
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

// ============================================================
// VALIDATION
// ============================================================
function validateRating(value, fieldName = 'Rating') {
    if (value === undefined || value === null) return { valid: true };
    const num = parseInt(value);
    if (isNaN(num) || num < RATING_MIN || num > RATING_MAX) {
        return { valid: false, error: `${fieldName} must be between ${RATING_MIN} and ${RATING_MAX}` };
    }
    return { valid: true };
}

function validateReview(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.guest || data.guest.trim() === '') errors.push('Guest name is required');

        const overallValidation = validateRating(data.overall, 'Overall rating');
        if (!overallValidation.valid) errors.push(overallValidation.error);

        if (!data.overall) errors.push('Overall rating is required');
    }

    // Validate optional ratings
    ['service', 'cleanliness', 'value', 'location'].forEach(field => {
        if (data[field] !== undefined) {
            const v = validateRating(data[field], field);
            if (!v.valid) errors.push(v.error);
        }
    });

    return { valid: errors.length === 0, errors };
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createReview(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validateReview(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const review = {
            hotelId,
            guest: data.guest.trim(),
            email: data.email ? data.email.toLowerCase().trim() : null,
            room: data.room ? parseInt(data.room) : null,
            overall: parseInt(data.overall),
            service: data.service ? parseInt(data.service) : null,
            cleanliness: data.cleanliness ? parseInt(data.cleanliness) : null,
            value: data.value ? parseInt(data.value) : null,
            location: data.location ? parseInt(data.location) : null,
            comment: data.comment?.trim() || '',
            recommend: data.recommend !== false,
            status: 'pending',
            adminReply: '',
            adminReplyTime: null,
            helpful: 0,
            date: data.date || new Date().toISOString(),
            _version: 1,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('reviews').insertOne(review);
        review._id = result.insertedId.toString();
        return review;
    } catch (error) {
        console.error('❌ createReview error:', error.message);
        throw error;
    }
}

async function getReviews(hotelId, options = {}) {
    try {
        if (!isConnected()) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
        const db = getDB();
        if (!db) return { items: [], total: 0, page: 1, limit: 50, pages: 0 };

        const { status, rating, room, search, approvedOnly = false, limit = 50, page = 1 } = options;
        const filter = { hotelId, isDeleted: { $ne: true } };

        if (status) filter.status = status;
        if (approvedOnly) filter.status = 'approved';
        if (rating) filter.overall = parseInt(rating);
        if (room) filter.room = parseInt(room);

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            filter.$or = [
                { guest: searchRegex },
                { comment: searchRegex }
            ];
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            db.collection('reviews')
                .find(filter)
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('reviews').countDocuments(filter)
        ]);

        items.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (error) {
        console.error('❌ getReviews error:', error.message);
        return { items: [], total: 0, page: 1, limit: 50, pages: 0 };
    }
}

async function getReviewById(hotelId, reviewId) {
    try {
        if (!isConnected() || !ObjectId.isValid(reviewId)) return null;
        const db = getDB();
        if (!db) return null;

        const review = await db.collection('reviews').findOne({
            _id: new ObjectId(reviewId),
            hotelId,
            isDeleted: { $ne: true }
        });

        if (review && review._id) review._id = review._id.toString();
        return review;
    } catch (error) {
        console.error('❌ getReviewById error:', error.message);
        return null;
    }
}

async function updateReview(hotelId, reviewId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(reviewId)) throw new Error('Invalid review ID');

        const validation = validateReview(updates, true);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        const updateData = { updatedAt: new Date() };

        if (updates.guest) updateData.guest = updates.guest.trim();
        if (updates.email !== undefined) {
            updateData.email = updates.email ? updates.email.toLowerCase().trim() : null;
        }
        if (updates.room !== undefined) updateData.room = updates.room ? parseInt(updates.room) : null;
        if (updates.overall !== undefined) updateData.overall = parseInt(updates.overall);
        if (updates.service !== undefined) updateData.service = parseInt(updates.service);
        if (updates.cleanliness !== undefined) updateData.cleanliness = parseInt(updates.cleanliness);
        if (updates.value !== undefined) updateData.value = parseInt(updates.value);
        if (updates.location !== undefined) updateData.location = parseInt(updates.location);
        if (updates.comment !== undefined) updateData.comment = updates.comment.trim();
        if (updates.recommend !== undefined) updateData.recommend = updates.recommend;
        if (updates.status && REVIEW_STATUSES.includes(updates.status)) {
            updateData.status = updates.status;
        }

        const result = await db.collection('reviews').findOneAndUpdate(
            { _id: new ObjectId(reviewId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Review not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updateReview error:', error.message);
        throw error;
    }
}

async function deleteReview(hotelId, reviewId) {
    try {
        if (!isConnected() || !ObjectId.isValid(reviewId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('reviews').findOneAndUpdate(
            { _id: new ObjectId(reviewId), hotelId, isDeleted: { $ne: true } },
            {
                $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
                $inc: { _version: 1 }
            }
        );

        return !!result;
    } catch (error) {
        console.error('❌ deleteReview error:', error.message);
        return false;
    }
}

// ============================================================
// MODERATION
// ============================================================
async function approveReview(hotelId, reviewId) {
    return await updateReview(hotelId, reviewId, { status: 'approved' });
}

async function rejectReview(hotelId, reviewId) {
    return await updateReview(hotelId, reviewId, { status: 'rejected' });
}

async function addAdminReply(hotelId, reviewId, reply) {
    try {
        if (!isConnected() || !ObjectId.isValid(reviewId)) {
            throw new Error('Invalid review ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const result = await db.collection('reviews').findOneAndUpdate(
            { _id: new ObjectId(reviewId), hotelId, isDeleted: { $ne: true } },
            {
                $set: {
                    adminReply: reply,
                    adminReplyTime: new Date(),
                    updatedAt: new Date()
                },
                $inc: { _version: 1 }
            },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Review not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ addAdminReply error:', error.message);
        throw error;
    }
}

async function markHelpful(hotelId, reviewId) {
    try {
        if (!isConnected() || !ObjectId.isValid(reviewId)) {
            throw new Error('Invalid review ID');
        }
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const result = await db.collection('reviews').findOneAndUpdate(
            { _id: new ObjectId(reviewId), hotelId, isDeleted: { $ne: true } },
            { $inc: { helpful: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Review not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ markHelpful error:', error.message);
        throw error;
    }
}

// ============================================================
// SEARCH & FILTER
// ============================================================
async function getReviewsByGuest(hotelId, guestName) {
    try {
        const db = getDB();
        if (!db) return [];

        const reviews = await db.collection('reviews')
            .find({
                hotelId,
                guest: { $regex: guestName, $options: 'i' },
                isDeleted: { $ne: true }
            })
            .sort({ date: -1 })
            .toArray();

        reviews.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return reviews;
    } catch (error) {
        console.error('❌ getReviewsByGuest error:', error.message);
        return [];
    }
}

async function getReviewsByRoom(hotelId, roomNumber) {
    try {
        const db = getDB();
        if (!db) return [];

        const reviews = await db.collection('reviews')
            .find({
                hotelId,
                room: parseInt(roomNumber),
                isDeleted: { $ne: true }
            })
            .sort({ date: -1 })
            .toArray();

        reviews.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return reviews;
    } catch (error) {
        console.error('❌ getReviewsByRoom error:', error.message);
        return [];
    }
}

async function getTopReviews(hotelId, limit = 10) {
    try {
        const db = getDB();
        if (!db) return [];

        const reviews = await db.collection('reviews')
            .find({
                hotelId,
                status: 'approved',
                isDeleted: { $ne: true }
            })
            .sort({ overall: -1, helpful: -1, date: -1 })
            .limit(limit)
            .toArray();

        reviews.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return reviews;
    } catch (error) {
        console.error('❌ getTopReviews error:', error.message);
        return [];
    }
}

async function getRecentReviews(hotelId, limit = 10) {
    try {
        const db = getDB();
        if (!db) return [];

        const reviews = await db.collection('reviews')
            .find({
                hotelId,
                status: 'approved',
                isDeleted: { $ne: true }
            })
            .sort({ date: -1 })
            .limit(limit)
            .toArray();

        reviews.forEach(r => { if (r._id) r._id = r._id.toString(); });
        return reviews;
    } catch (error) {
        console.error('❌ getRecentReviews error:', error.message);
        return [];
    }
}

// ============================================================
// STATISTICS
// ============================================================
async function getReviewStats(hotelId) {
    try {
        if (!isConnected()) {
            return { total: 0, avgOverall: 0, avgService: 0, avgCleanliness: 0, distribution: {}, recommendRate: 0 };
        }
        const db = getDB();
        if (!db) {
            return { total: 0, avgOverall: 0, avgService: 0, avgCleanliness: 0, distribution: {}, recommendRate: 0 };
        }

        const stats = await db.collection('reviews').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true }, status: 'approved' } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    avgOverall: { $avg: '$overall' },
                    avgService: { $avg: '$service' },
                    avgCleanliness: { $avg: '$cleanliness' },
                    avgValue: { $avg: '$value' },
                    avgLocation: { $avg: '$location' },
                    recommendCount: { $sum: { $cond: ['$recommend', 1, 0] } }
                }
            }
        ]).toArray();

        const distribution = await db.collection('reviews').aggregate([
            { $match: { hotelId, isDeleted: { $ne: true }, status: 'approved' } },
            {
                $group: {
                    _id: '$overall',
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: -1 } }
        ]).toArray();

        const result = stats[0] || {
            total: 0,
            avgOverall: 0,
            avgService: 0,
            avgCleanliness: 0,
            avgValue: 0,
            avgLocation: 0,
            recommendCount: 0
        };

        const recommendRate = result.total > 0 
            ? ((result.recommendCount / result.total) * 100).toFixed(1)
            : 0;

        return {
            total: result.total,
            avgOverall: result.avgOverall ? result.avgOverall.toFixed(1) : 0,
            avgService: result.avgService ? result.avgService.toFixed(1) : 0,
            avgCleanliness: result.avgCleanliness ? result.avgCleanliness.toFixed(1) : 0,
            avgValue: result.avgValue ? result.avgValue.toFixed(1) : 0,
            avgLocation: result.avgLocation ? result.avgLocation.toFixed(1) : 0,
            recommendRate,
            distribution: distribution.reduce((acc, d) => {
                acc[d._id] = d.count;
                return acc;
            }, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 })
        };
    } catch (error) {
        console.error('❌ getReviewStats error:', error.message);
        return { total: 0, avgOverall: 0, distribution: {}, recommendRate: 0 };
    }
}

async function getReviewCount(hotelId, filters = {}) {
    try {
        if (!isConnected()) return 0;
        const db = getDB();
        if (!db) return 0;

        const query = { hotelId, isDeleted: { $ne: true } };
        if (filters.status) query.status = filters.status;
        if (filters.rating) query.overall = parseInt(filters.rating);

        return await db.collection('reviews').countDocuments(query);
    } catch (error) {
        console.error('❌ getReviewCount error:', error.message);
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

        await db.collection('reviews').createIndex(
            { hotelId: 1, status: 1 },
            { background: true, name: 'hotelId_status_idx' }
        );
        await db.collection('reviews').createIndex(
            { hotelId: 1, overall: -1 },
            { background: true, name: 'hotelId_overall_idx' }
        );
        await db.collection('reviews').createIndex(
            { hotelId: 1, date: -1 },
            { background: true, name: 'hotelId_date_idx' }
        );
        await db.collection('reviews').createIndex(
            { hotelId: 1, room: 1 },
            { background: true, name: 'hotelId_room_idx' }
        );
        await db.collection('reviews').createIndex(
            { hotelId: 1, isDeleted: 1 },
            { background: true, name: 'hotelId_isDeleted_idx' }
        );

        console.log('✅ Review indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    RATING_MIN,
    RATING_MAX,
    REVIEW_STATUSES,
    validateRating,
    validateReview,
    createReview,
    getReviews,
    getReviewById,
    updateReview,
    deleteReview,
    approveReview,
    rejectReview,
    addAdminReply,
    markHelpful,
    getReviewsByGuest,
    getReviewsByRoom,
    getTopReviews,
    getRecentReviews,
    getReviewStats,
    getReviewCount,
    createIndexes
};