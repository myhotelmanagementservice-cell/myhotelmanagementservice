// server/models/Policy.js
// Hotel Policies Management - Native MongoDB Compatible

const { getDB, isConnected } = require('../config/db');
const { ObjectId } = require('mongodb');

// ============================================================
// CONSTANTS
// ============================================================
const POLICY_TYPES = ['privacy', 'terms', 'checkin', 'checkout', 'cancellation', 'refund', 'custom'];
const LANGUAGES = ['en', 'hi', 'ar'];

// ============================================================
// VALIDATION
// ============================================================
function validatePolicy(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate) {
        if (!data.type || !POLICY_TYPES.includes(data.type)) {
            errors.push(`Invalid type. Must be: ${POLICY_TYPES.join(', ')}`);
        }
        if (!data.content) errors.push('Content is required');
        if (typeof data.content === 'object' && !data.content.en) {
            errors.push('English content is required');
        }
    }

    return { valid: errors.length === 0, errors };
}

function normalizeContent(content) {
    if (!content) return { en: '', hi: '', ar: '' };
    if (typeof content === 'string') return { en: content, hi: '', ar: '' };
    return {
        en: content.en || '',
        hi: content.hi || '',
        ar: content.ar || ''
    };
}

function getLocalizedContent(policy, lang = 'en') {
    if (!policy || !policy.content) return '';
    return policy.content[lang] || policy.content.en || '';
}

// ============================================================
// CRUD OPERATIONS
// ============================================================
async function createPolicy(hotelId, data) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        const validation = validatePolicy(data);
        if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);

        // Check duplicate type
        const existing = await db.collection('policies').findOne({ hotelId, type: data.type });
        if (existing) throw new Error(`Policy of type "${data.type}" already exists`);

        const policy = {
            hotelId,
            type: data.type,
            title: data.title || '',
            content: normalizeContent(data.content),
            isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
            _version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('policies').insertOne(policy);
        policy._id = result.insertedId.toString();
        return policy;
    } catch (error) {
        console.error('❌ createPolicy error:', error.message);
        throw error;
    }
}

async function getPolicies(hotelId, options = {}) {
    try {
        if (!isConnected()) return [];
        const db = getDB();
        if (!db) return [];

        const { type, enabledOnly = false } = options;
        const filter = { hotelId };

        if (type) filter.type = type;
        if (enabledOnly) filter.isEnabled = true;

        const policies = await db.collection('policies')
            .find(filter)
            .sort({ type: 1 })
            .toArray();

        policies.forEach(p => { if (p._id) p._id = p._id.toString(); });
        return policies;
    } catch (error) {
        console.error('❌ getPolicies error:', error.message);
        return [];
    }
}

async function getPolicyById(hotelId, policyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(policyId)) return null;
        const db = getDB();
        if (!db) return null;

        const policy = await db.collection('policies').findOne({
            _id: new ObjectId(policyId),
            hotelId
        });

        if (policy && policy._id) policy._id = policy._id.toString();
        return policy;
    } catch (error) {
        console.error('❌ getPolicyById error:', error.message);
        return null;
    }
}

async function getPolicyByType(hotelId, type) {
    try {
        if (!POLICY_TYPES.includes(type)) return null;
        const db = getDB();
        if (!db) return null;

        const policy = await db.collection('policies').findOne({ hotelId, type });
        if (policy && policy._id) policy._id = policy._id.toString();
        return policy;
    } catch (error) {
        console.error('❌ getPolicyByType error:', error.message);
        return null;
    }
}

async function updatePolicy(hotelId, policyId, updates) {
    try {
        if (!isConnected()) throw new Error('Database not connected');
        const db = getDB();
        if (!db) throw new Error('Database not available');

        if (!ObjectId.isValid(policyId)) throw new Error('Invalid policy ID');

        const updateData = { updatedAt: new Date() };

        if (updates.type && POLICY_TYPES.includes(updates.type)) {
            updateData.type = updates.type;
        }
        if (updates.title !== undefined) updateData.title = updates.title;
        if (updates.content) updateData.content = normalizeContent(updates.content);
        if (updates.isEnabled !== undefined) updateData.isEnabled = updates.isEnabled;

        const result = await db.collection('policies').findOneAndUpdate(
            { _id: new ObjectId(policyId), hotelId },
            { $set: updateData, $inc: { _version: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) throw new Error('Policy not found');
        if (result._id) result._id = result._id.toString();
        return result;
    } catch (error) {
        console.error('❌ updatePolicy error:', error.message);
        throw error;
    }
}

async function deletePolicy(hotelId, policyId) {
    try {
        if (!isConnected() || !ObjectId.isValid(policyId)) return false;
        const db = getDB();
        if (!db) return false;

        const result = await db.collection('policies').deleteOne({
            _id: new ObjectId(policyId),
            hotelId
        });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('❌ deletePolicy error:', error.message);
        return false;
    }
}

async function togglePolicy(hotelId, policyId) {
    try {
        const policy = await getPolicyById(hotelId, policyId);
        if (!policy) throw new Error('Policy not found');
        return await updatePolicy(hotelId, policyId, { isEnabled: !policy.isEnabled });
    } catch (error) {
        console.error('❌ togglePolicy error:', error.message);
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

        await db.collection('policies').createIndex(
            { hotelId: 1, type: 1 },
            { unique: true, background: true, name: 'hotelId_type_unique' }
        );
        await db.collection('policies').createIndex(
            { hotelId: 1, isEnabled: 1 },
            { background: true, name: 'hotelId_isEnabled_idx' }
        );

        console.log('✅ Policy indexes created');
    } catch (error) {
        console.error('❌ createIndexes error:', error.message);
    }
}

module.exports = {
    POLICY_TYPES,
    LANGUAGES,
    validatePolicy,
    normalizeContent,
    getLocalizedContent,
    createPolicy,
    getPolicies,
    getPolicyById,
    getPolicyByType,
    updatePolicy,
    deletePolicy,
    togglePolicy,
    createIndexes
};