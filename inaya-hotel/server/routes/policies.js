const express = require('express');
const router = express.Router();
const Policy = require('../models/Policy');

// GET all policies for a hotel
router.get('/', async (req, res) => {
    try {
        const { hotelId } = req.query;
        if (!hotelId) {
            return res.status(400).json({ error: 'hotelId is required' });
        }
        const policies = await Policy.find({ hotelId });
        res.json(policies);
    } catch (error) {
        console.error('GET /policies error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET single policy
router.get('/:id', async (req, res) => {
    try {
        const policy = await Policy.findById(req.params.id);
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }
        res.json(policy);
    } catch (error) {
        console.error('GET /policies/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST create policy
router.post('/', async (req, res) => {
    try {
        const { hotelId, type, content, isEnabled } = req.body;
        if (!hotelId || !type || !content) {
            return res.status(400).json({ error: 'hotelId, type, and content are required' });
        }
        const policy = new Policy({
            hotelId,
            type,
            content,
            isEnabled: isEnabled !== undefined ? isEnabled : true,
            _version: 1
        });
        await policy.save();
        res.status(201).json(policy);
    } catch (error) {
        console.error('POST /policies error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update policy
router.put('/:id', async (req, res) => {
    try {
        const { type, content, isEnabled } = req.body;
        const policy = await Policy.findById(req.params.id);
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }
        if (type) policy.type = type;
        if (content) policy.content = content;
        if (isEnabled !== undefined) policy.isEnabled = isEnabled;
        policy._version = (policy._version || 0) + 1;
        policy.updatedAt = new Date();
        await policy.save();
        res.json(policy);
    } catch (error) {
        console.error('PUT /policies/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE policy
router.delete('/:id', async (req, res) => {
    try {
        const policy = await Policy.findByIdAndDelete(req.params.id);
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }
        res.json({ success: true, message: 'Policy deleted' });
    } catch (error) {
        console.error('DELETE /policies/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;