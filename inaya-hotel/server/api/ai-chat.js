const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.post('/message', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const { hotelId, guestId, message, language = 'en' } = req.body;

        // Get AI Config
        const aiConfig = await db.collection('hotel_ai_settings').findOne({ hotel_id: hotelId });
        const customResponses = aiConfig?.custom_responses || {};
        const faqs = aiConfig?.faq_json || {};

        let reply = "I'm sorry, I didn't quite understand that. Please contact 24/7 support.";
        const lowerMsg = message.toLowerCase();

        // Check custom responses
        for (const [key, value] of Object.entries(customResponses)) {
            if (lowerMsg.includes(key.toLowerCase())) {
                reply = language === 'ar' ? (value.ar || value.en) : value.en;
                break;
            }
        }

        // Save chat history
        await db.collection('chat_history').insertOne({
            hotel_id: hotelId,
            guest_id: guestId,
            user_message: message,
            bot_response: reply,
            language,
            created_at: new Date()
        });

        res.json({ success: true, reply });
    } catch (error) {
        console.error('Error in AI chat:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
