const express = require('express');
const router = express.Router();
const Maintenance = require('../models/Maintenance');

router.get('/', async (req, res) => {
  try {
    const tasks = await Maintenance.find();
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const task = new Maintenance(req.body);
    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const task = await Maintenance.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: task });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Maintenance.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
