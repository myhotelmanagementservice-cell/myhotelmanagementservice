const express = require('express');
const router = express.Router();
const Announcement = require('../models/Announcement');

// GET all announcements for a hotel
router.get('/', async (req, res) => {
    try {
        const { hotelId } = req.query; 
        if (!hotelId) {
            return res.status(400).json({ error: 'hotelId is required' });
        }
        const announcements = await Announcement.find({ hotelId }).sort({ createdAt: -1 });
        res.json(announcements);
    } catch (error) {
        console.error('GET /announcements error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET single announcement
router.get('/:id', async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }
        res.json(announcement);
    } catch (error) {
        console.error('GET /announcements/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST create announcement
router.post('/', async (req, res) => {
    try {
        const { hotelId, category, title, message, isActive } = req.body;
        if (!hotelId || !category || !title || !message) {
            return res.status(400).json({ error: 'hotelId, category, title, and message are required' });
        }
        const announcement = new Announcement({
            hotelId,
            category,
            title,
            message,
            isActive: isActive !== undefined ? isActive : true,
            _version: 1
        });
        await announcement.save();
        res.status(201).json(announcement);
    } catch (error) {
        console.error('POST /announcements error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update announcement
router.put('/:id', async (req, res) => {
    try {
        const { category, title, message, isActive } = req.body;
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }
        if (category) announcement.category = category;
        if (title) announcement.title = title;
        if (message) announcement.message = message;
        if (isActive !== undefined) announcement.isActive = isActive;
        announcement._version = (announcement._version || 0) + 1;
        announcement.updatedAt = new Date();
        await announcement.save();
        res.json(announcement);
    } catch (error) {
        console.error('PUT /announcements/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE announcement
router.delete('/:id', async (req, res) => {
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }
        res.json({ success: true, message: 'Announcement deleted' });
    } catch (error) {
        console.error('DELETE /announcements/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;