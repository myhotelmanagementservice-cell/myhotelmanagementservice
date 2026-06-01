const express = require('express');
const router = express.Router();

// GET /api/dashboard - Fetch real-time, hotel-scoped statistics
router.get('/', async (req, res) => {
  try {
    const db = req.app.get('db');
    const hotelId = req.hotelId;

    if (!db) {
      return res.status(503).json({ 
        success: false, 
        error: 'Database not connected' 
      });
    }

    // ✅ Run parallel queries for optimal performance
    const [
      rooms,
      requests,
      bookings,
      guests,
      inventory,
      staff
    ] = await Promise.all([
      db.collection('rooms').find({ hotelId }).toArray(),
      db.collection('requests').find({ hotelId }).toArray(),
      db.collection('bookings').find({ hotelId }).toArray(),
      db.collection('guests').find({ hotelId }).toArray(),
      db.collection('inventory').find({ hotelId }).toArray(),
      db.collection('staff').find({ hotelId }).toArray()
    ]);

    // ✅ Calculate real-time metrics
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
    const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
    const cleaningRooms = rooms.filter(r => r.status === 'Cleaning').length;

    const totalRequests = requests.length;
    const openRequests = requests.filter(r => r.status === 'open').length;
    const pendingRequests = requests.filter(r => r.status === 'in_progress' || r.status === 'pending').length;
    const emergencyRequests = requests.filter(r => r.priority === 'emergency' && r.status !== 'completed').length;

    // Revenue from completed/checked-out bookings only
    const totalRevenue = bookings
      .filter(b => b.status === 'checked-out' || b.status === 'completed')
      .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    const activeGuests = guests.filter(g => g.status === 'active').length;
    const lowStockItems = inventory.filter(i => i.stock <= (i.min || 10)).length;
    const totalStaff = staff.length;
    const onDutyStaff = staff.filter(s => s.status === 'online' || s.status === 'on-duty').length;

    res.json({
      success: true,
      data: {
        rooms: { 
          total: totalRooms, 
          occupied: occupiedRooms, 
          vacant: vacantRooms, 
          cleaning: cleaningRooms 
        },
        requests: { 
          total: totalRequests, 
          open: openRequests, 
          pending: pendingRequests, 
          emergency: emergencyRequests 
        },
        bookings: { 
          total: bookings.length, 
          revenue: totalRevenue 
        },
        guests: { 
          total: guests.length, 
          active: activeGuests 
        },
        inventory: { 
          total: inventory.length, 
          lowStock: lowStockItems 
        },
        staff: { 
          total: totalStaff, 
          onDuty: onDutyStaff 
        }
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch dashboard stats' 
    });
  }
});

module.exports = router;
