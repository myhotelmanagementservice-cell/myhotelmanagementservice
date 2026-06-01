const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { protect, authorize } = require('../middleware/auth');

// Helper: Get DB instance from app
const getDB = (req) => req.app.get('db');

// Helper: Get IO instance for broadcasting
const getIO = (req) => req.app.get('io');

// Helper: Broadcast to hotel room
const broadcast = (req, event, data) => {
  const io = getIO(req);
  const hotelId = req.hotelId;
  if (io && hotelId) {
    io.to(`hotel_${hotelId}`).emit(event, data);
  }
};

// ============================================
// GET all hotels (Super Admin only)
// ============================================
router.get('/', protect, authorize('super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { status, search, limit = 50 } = req.query;

    let query = {};
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { hotelId: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } }
      ];
    }

    const hotels = await db.collection('tenants')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Get stats for each hotel (parallel execution)
    const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
      const [userCount, roomCount, bookingCount] = await Promise.all([
        db.collection('users').countDocuments({ hotelId: hotel.hotelId }),
        db.collection('rooms').countDocuments({ hotelId: hotel.hotelId }),
        db.collection('bookings').countDocuments({ hotelId: hotel.hotelId })
      ]);

      return {
        ...hotel,
        stats: {
          users: userCount,
          rooms: roomCount,
          bookings: bookingCount
        }
      };
    }));

    res.json({
      success: true,
      count: hotelsWithStats.length,
      data: hotelsWithStats
    });
  } catch (error) {
    console.error('Get hotels error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET single hotel by ID
// ============================================
router.get('/:hotelId', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { hotelId } = req.params;
    const userRole = req.user?.role;
    const userHotelId = req.user?.hotelId;

    // Check permission
    if (userRole !== 'super_admin' && userHotelId !== hotelId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only view your own hotel.'
      });
    }

    const hotel = await db.collection('tenants').findOne({ hotelId });

    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    // Get detailed stats in parallel
    const [userCount, roomCount, bookingCount, activeBookings] = await Promise.all([
      db.collection('users').countDocuments({ hotelId, isActive: true }),
      db.collection('rooms').countDocuments({ hotelId }),
      db.collection('bookings').countDocuments({ hotelId }),
      db.collection('bookings').countDocuments({
        hotelId,
        status: { $in: ['confirmed', 'checked-in'] },
        checkIn: { $lte: new Date() },
        checkOut: { $gte: new Date() }
      })
    ]);

    res.json({
      success: true,
      data: {
        ...hotel,
        stats: {
          users: userCount,
          rooms: roomCount,
          totalBookings: bookingCount,
          currentOccupancy: activeBookings
        }
      }
    });
  } catch (error) {
    console.error('Get hotel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// CREATE new hotel (Super Admin only)
// ============================================
router.post('/', protect, authorize('super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const {
      hotelId,
      hotelName,
      country,
      countryCode,
      currency,
      currencySymbol,
      timezone,
      language,
      wifiPassword,
      phone,
      email,
      address,
      logo,
      theme,
      subscriptionType
    } = req.body;

    // Validation
    if (!hotelId || !hotelName || !country || !countryCode) {
      return res.status(400).json({
        success: false,
        error: 'Hotel ID, name, country, and country code are required'
      });
    }

    // Check if hotel already exists
    const existingHotel = await db.collection('tenants').findOne({
      $or: [{ hotelId }, { email }]
    });
    if (existingHotel) {
      return res.status(400).json({
        success: false,
        error: 'Hotel with this ID or email already exists'
      });
    }

    // Calculate subscription expiry
    let subscriptionExpiry = null;
    if (subscriptionType === 'enterprise') {
      subscriptionExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    } else if (subscriptionType === 'pro') {
      subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    } else if (subscriptionType === 'basic') {
      subscriptionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    const hotel = {
      hotelId: hotelId.toUpperCase(),
      hotelName,
      country,
      countryCode: countryCode.toUpperCase(),
      currency: currency || 'USD',
      currencySymbol: currencySymbol || '$',
      timezone: timezone || 'Asia/Kolkata',
      language: language || 'en',
      wifiPassword: wifiPassword || `${hotelName}@2024`,
      phone: phone || '',
      email,
      address: address || '',
      logo: logo || '',
      theme: theme || { primaryColor: '#8B5CF6', secondaryColor: '#F59E0B' },
      subscriptionType: subscriptionType || 'basic',
      subscriptionExpiry,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('tenants').insertOne(hotel);
    hotel._id = result.insertedId;

    // Create default admin user for this hotel
    const hashedPassword = await require('bcryptjs').hash('Admin@123', 10);
    const defaultAdmin = {
      hotelId: hotel.hotelId,
      email: `admin@${hotelId.toLowerCase()}.com`,
      password: hashedPassword,
      name: `${hotelName} Administrator`,
      role: 'hotel_admin',
      permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings', 'staff', 'bookings'],
      isActive: true,
      createdAt: new Date()
    };
    await db.collection('users').insertOne(defaultAdmin);

    // Create default settings
    await db.collection('settings').insertOne({
      hotelId: hotel.hotelId,
      hotelName,
      currencySymbol: currencySymbol || '$',
      priceFormat: 'symbol-first',
      taxRate: 0,
      wifiSSID: `${hotelName.replace(/\s+/g, '_')}_Guest`,
      wifiPassword: wifiPassword || `${hotelName}@2024`,
      language: language || 'en',
      theme: { primaryColor: '#667eea' },
      transport: { airport: 30, local: 15 },
      updatedAt: new Date()
    });

    // Broadcast new hotel created
    broadcast(req, 'hotel_new', { hotelId: hotel.hotelId, hotelName });

    res.status(201).json({
      success: true,
      message: 'Hotel created successfully',
      data: hotel,
      defaultAdmin: {
        email: defaultAdmin.email,
        password: 'Admin@123',
        message: 'Please change password on first login'
      }
    });
  } catch (error) {
    console.error('Create hotel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// UPDATE hotel (Super Admin or Hotel Admin)
// ============================================
router.put('/:hotelId', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { hotelId } = req.params;
    const userRole = req.user?.role;
    const userHotelId = req.user?.hotelId;

    // Check permission
    if (userRole !== 'super_admin' && userHotelId !== hotelId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only update your own hotel.'
      });
    }

    const hotel = await db.collection('tenants').findOne({ hotelId });
    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    const {
      hotelName,
      country,
      countryCode,
      currency,
      currencySymbol,
      timezone,
      language,
      wifiPassword,
      phone,
      email,
      address,
      logo,
      theme,
      subscriptionType,
      isActive
    } = req.body;

    const updateData = {
      updatedAt: new Date(),
      ...(hotelName && { hotelName }),
      ...(country && { country }),
      ...(countryCode && { countryCode: countryCode.toUpperCase() }),
      ...(currency && { currency }),
      ...(currencySymbol && { currencySymbol }),
      ...(timezone && { timezone }),
      ...(language && { language }),
      ...(wifiPassword && { wifiPassword }),
      ...(phone !== undefined && { phone }),
      ...(email && { email }),
      ...(address !== undefined && { address }),
      ...(logo !== undefined && { logo }),
      ...(theme && { theme: { ...hotel.theme, ...theme } }),
      ...(subscriptionType && userRole === 'super_admin' && { subscriptionType }),
      ...(isActive !== undefined && userRole === 'super_admin' && { isActive })
    };

    await db.collection('tenants').updateOne({ hotelId }, { $set: updateData });
    const updatedHotel = await db.collection('tenants').findOne({ hotelId });

    // Broadcast config update
    broadcast(req, 'cfg_upd', {
      hotelName: updatedHotel.hotelName,
      currency: updatedHotel.currency,
      currencySymbol: updatedHotel.currencySymbol,
      language: updatedHotel.language,
      theme: updatedHotel.theme
    });

    res.json({
      success: true,
      message: 'Hotel updated successfully',
      data: updatedHotel
    });
  } catch (error) {
    console.error('Update hotel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// DELETE hotel (Soft delete - Super Admin only)
// ============================================
router.delete('/:hotelId', protect, authorize('super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { hotelId } = req.params;
    const hotel = await db.collection('tenants').findOne({ hotelId });

    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    // Soft delete hotel
    await db.collection('tenants').updateOne(
      { hotelId },
      { $set: { isActive: false, deletedAt: new Date(), updatedAt: new Date() } }
    );

    // Deactivate all users of this hotel
    await db.collection('users').updateMany(
      { hotelId },
      { $set: { isActive: false, updatedAt: new Date() } }
    );

    // Notify connected clients
    const io = getIO(req);
    if (io) {
      io.to(`hotel_${hotelId}`).emit('hotel_deleted', { message: 'This hotel has been deactivated' });
    }

    res.json({ success: true, message: 'Hotel deactivated successfully' });
  } catch (error) {
    console.error('Delete hotel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET hotel settings (for current hotel)
// ============================================
router.get('/settings/current', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const hotelId = req.hotelId || req.user?.hotelId;
    const hotel = await db.collection('tenants').findOne({ hotelId });

    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    res.json({
      success: true,
      data: {
        name: hotel.hotelName,
        hotelId: hotel.hotelId,
        currency: hotel.currency,
        currencySymbol: hotel.currencySymbol,
        timezone: hotel.timezone,
        language: hotel.language,
        wifiPassword: hotel.wifiPassword,
        phone: hotel.phone,
        email: hotel.email,
        address: hotel.address,
        logo: hotel.logo,
        theme: hotel.theme,
        country: hotel.country,
        countryCode: hotel.countryCode
      }
    });
  } catch (error) {
    console.error('Get hotel settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// UPDATE hotel settings
// ============================================
router.put('/settings/current', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const hotelId = req.hotelId || req.user?.hotelId;
    const {
      hotelName,
      currency,
      currencySymbol,
      timezone,
      language,
      wifiPassword,
      phone,
      email,
      address,
      logo,
      theme
    } = req.body;

    const hotel = await db.collection('tenants').findOne({ hotelId });
    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    const updateData = {
      updatedAt: new Date(),
      ...(hotelName && { hotelName }),
      ...(currency && { currency }),
      ...(currencySymbol && { currencySymbol }),
      ...(timezone && { timezone }),
      ...(language && { language }),
      ...(wifiPassword && { wifiPassword }),
      ...(phone !== undefined && { phone }),
      ...(email && { email }),
      ...(address !== undefined && { address }),
      ...(logo !== undefined && { logo }),
      ...(theme && { theme: { ...hotel.theme, ...theme } })
    };

    await db.collection('tenants').updateOne({ hotelId }, { $set: updateData });
    const updatedHotel = await db.collection('tenants').findOne({ hotelId });

    // Broadcast config update
    broadcast(req, 'cfg_upd', {
      hotelName: updatedHotel.hotelName,
      currency: updatedHotel.currency,
      currencySymbol: updatedHotel.currencySymbol,
      language: updatedHotel.language,
      theme: updatedHotel.theme
    });

    res.json({
      success: true,
      message: 'Hotel settings updated successfully',
      data: updatedHotel
    });
  } catch (error) {
    console.error('Update hotel settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET hotel dashboard stats
// ============================================
router.get('/dashboard/stats', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const hotelId = req.hotelId || req.user?.hotelId;
    const { period = 'month' } = req.query;

    let startDate;
    const endDate = new Date();

    switch (period) {
      case 'week':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
    }

    const [totalRooms, occupiedRooms, totalBookings, activeBookings, revenueResult] = await Promise.all([
      db.collection('rooms').countDocuments({ hotelId }),
      db.collection('rooms').countDocuments({ hotelId, status: 'Occupied' }),
      db.collection('bookings').countDocuments({ hotelId }),
      db.collection('bookings').countDocuments({
        hotelId,
        status: { $in: ['confirmed', 'checked-in'] },
        checkIn: { $lte: new Date() },
        checkOut: { $gte: new Date() }
      }),
      db.collection('bookings').aggregate([
        { $match: { hotelId, createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]).toArray()
    ]);

    // Monthly booking trend
    const monthlyTrend = await db.collection('bookings').aggregate([
      { $match: { hotelId, createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: {
        _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
        count: { $sum: 1 },
        revenue: { $sum: '$totalPrice' }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]).toArray();

    res.json({
      success: true,
      data: {
        rooms: {
          total: totalRooms,
          occupied: occupiedRooms,
          available: totalRooms - occupiedRooms,
          occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
        },
        bookings: {
          total: totalBookings,
          active: activeBookings,
          revenue: revenueResult[0]?.total || 0
        },
        trend: monthlyTrend
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET hotels by country
// ============================================
router.get('/country/:countryCode', protect, authorize('super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const { countryCode } = req.params;

    const hotels = await db.collection('tenants')
      .find({
        countryCode: countryCode.toUpperCase(),
        isActive: true
      })
      .sort({ hotelName: 1 })
      .toArray();

    res.json({
      success: true,
      count: hotels.length,
      data: hotels
    });
  } catch (error) {
    console.error('Get hotels by country error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET hotel subscription info
// ============================================
router.get('/subscription/info', protect, async (req, res) => {
  try {
    const db = getDB(req);
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });

    const hotelId = req.hotelId || req.user?.hotelId;
    const hotel = await db.collection('tenants').findOne(
      { hotelId },
      { projection: { subscriptionType: 1, subscriptionExpiry: 1 } }
    );

    if (!hotel) {
      return res.status(404).json({ success: false, error: 'Hotel not found' });
    }

    const isExpired = hotel.subscriptionExpiry && new Date(hotel.subscriptionExpiry) < new Date();
    const daysRemaining = hotel.subscriptionExpiry
      ? Math.ceil((new Date(hotel.subscriptionExpiry) - new Date()) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      success: true,
      data: {
        subscriptionType: hotel.subscriptionType,
        subscriptionExpiry: hotel.subscriptionExpiry,
        isExpired,
        daysRemaining
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
