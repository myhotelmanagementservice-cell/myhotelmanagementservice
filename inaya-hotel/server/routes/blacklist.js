const express = require('express');
const router = express.Router();
const Blacklist = require('../models/Blacklist');

router.get('/', async (req, res) => {
  try {
    const entries = await Blacklist.find();
    res.json({ success: true, data: entries });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const entry = new Blacklist(req.body);
    await entry.save();
    res.json({ success: true, data: entry });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Blacklist.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
