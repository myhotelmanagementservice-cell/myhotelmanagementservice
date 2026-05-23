const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  res.json({
    success: true,
    data: {
      totalRooms: 120,
      occupiedRooms: 45,
      availableRooms: 75,
      totalRequests: 28,
      pendingRequests: 12,
      revenue: 125000
    }
  });
});

module.exports = router;
