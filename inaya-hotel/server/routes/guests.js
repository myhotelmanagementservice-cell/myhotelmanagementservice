const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');

router.get('/', async (req, res) => {
  try {
    const guests = await Guest.find();
    res.json({ success: true, data: guests });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const guest = new Guest(req.body);
    await guest.save();
    res.json({ success: true, data: guest });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
