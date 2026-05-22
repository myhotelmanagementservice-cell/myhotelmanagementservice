cat > server/controllers/adminController.js << 'EOF'
const Room = require('../models/Room');
const FoodItem = require('../models/FoodItem');
const Hotel = require('../models/Hotel');

// ============ ROOM CONTROLLER ============
exports.getRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ hotelId: req.hotelId });
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createRoom = async (req, res) => {
  try {
    const room = new Room({ ...req.body, hotelId: req.hotelId });
    await room.save();
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const room = await Room.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true }
    );
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    await Room.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============ FOOD MENU CONTROLLER ============
exports.getFoodItems = async (req, res) => {
  try {
    const items = await FoodItem.find({ hotelId: req.hotelId });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createFoodItem = async (req, res) => {
  try {
    const item = new FoodItem({ ...req.body, hotelId: req.hotelId });
    await item.save();
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.updateFoodItem = async (req, res) => {
  try {
    const item = await FoodItem.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true }
    );
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.deleteFoodItem = async (req, res) => {
  try {
    await FoodItem.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    res.json({ success: true, message: 'Food item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============ HOTEL SETTINGS CONTROLLER ============
exports.getHotelSettings = async (req, res) => {
  try {
    const hotel = await Hotel.findOne({ hotelId: req.hotelId });
    res.json({ success: true, data: hotel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateHotelSettings = async (req, res) => {
  try {
    const hotel = await Hotel.findOneAndUpdate(
      { hotelId: req.hotelId },
      req.body,
      { new: true }
    );
    res.json({ success: true, data: hotel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
EOF