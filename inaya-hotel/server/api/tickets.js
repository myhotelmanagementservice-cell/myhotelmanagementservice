const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Create Support Ticket
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId, description, priority = 'normal', category = 'general' } = req.body;

        const ticketId = `TKT${Date.now()}`;

        const newTicket = {
            ticket_id: ticketId,
            hotel_id: hotelId,
            guest_id: guestId,
            description,
            category,
            priority,
            status: 'open',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('support_tickets').insertOne(newTicket);

        res.json({ success: true, message: 'Ticket created successfully', ticketId });
    } catch (error) {
        console.error('Error creating ticket:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Guest Tickets
router.get('/list', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId } = req.query;

        const tickets = await db.collection('support_tickets')
            .find({ hotel_id: hotelId, guest_id: guestId })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();

        res.json({ success: true, tickets });
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
