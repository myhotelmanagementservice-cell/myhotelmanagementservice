cat > server/routes/requests.js << 'EOF'
const express = require('express');
const router = express.Router();
const Request = require('../models/Request');

router.get('/', async (req, res) => {
  try {
    const requests = await Request.find({ hotelId: req.hotelId }).sort({ createdAt: -1 });
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const request = new Request({ ...req.body, hotelId: req.hotelId });
    await request.save();
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
EOF