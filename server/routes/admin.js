cat > server/routes/admin.js << 'EOF'
const express = require('express');
const router = express.Router();
const {
  getRooms, createRoom, updateRoom, deleteRoom,
  getFoodItems, createFoodItem, updateFoodItem, deleteFoodItem,
  getHotelSettings, updateHotelSettings
} = require('../controllers/adminController');

// Room routes
router.get('/rooms', getRooms);
router.post('/rooms', createRoom);
router.put('/rooms/:id', updateRoom);
router.delete('/rooms/:id', deleteRoom);

// Food menu routes
router.get('/food', getFoodItems);
router.post('/food', createFoodItem);
router.put('/food/:id', updateFoodItem);
router.delete('/food/:id', deleteFoodItem);

// Hotel settings
router.get('/settings', getHotelSettings);
router.put('/settings', updateHotelSettings);

module.exports = router;
EOF