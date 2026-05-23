const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ success: true, data: [] });
});

router.post('/', async (req, res) => {
  res.json({ success: true, message: 'Booking created' });
});

module.exports = router;
