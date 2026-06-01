const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

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

// Helper: Log admin action
const logAction = async (req, action, details) => {
  const db = getDB(req);
  if (!db) return;
  await db.collection('logs').insertOne({
    hotelId: req.hotelId,
    user: req.user?.email || 'system',
    action,
    details,
    ip: req.ip,
    timestamp: new Date()
  }).catch(() => {});
};

// ============================================
// GET ALL BOOKINGS (with filters)
// ============================================
router.get('/', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, guestName, dateFrom, dateTo, roomNumber } = req.query;

    // Build filter with multi-tenant isolation
    const filter = { hotelId };

    if (status) filter.status = status;
    if (guestName) filter.guestName = { $regex: guestName, $options: 'i' };
    if (roomNumber) filter.roomNumber = parseInt(roomNumber);

    if (dateFrom || dateTo) {
      filter.checkIn = {};
      if (dateFrom) filter.checkIn.$gte = new Date(dateFrom);
      if (dateTo) filter.checkIn.$lte = new Date(dateTo);
    }

    const bookings = await db.collection('bookings')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: bookings, count: bookings.length });
  } catch (error) {
    console.error('GET /api/bookings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch bookings' });
  }
});

// ============================================
// GET SINGLE BOOKING BY ID
// ============================================
router.get('/:id', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid booking ID' });
    }

    const booking = await db.collection('bookings').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    res.json({ success: true, data: booking });
  } catch (error) {
    console.error('GET /api/bookings/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch booking' });
  }
});

// ============================================
// GET BOOKINGS FOR CURRENT GUEST
// ============================================
router.get('/guest/current', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const guestName = req.user?.name || req.query.guestName;

    if (!guestName) {
      return res.status(400).json({ success: false, error: 'Guest name required' });
    }

    const bookings = await db.collection('bookings')
      .find({ hotelId, guestName })
      .sort({ checkIn: -1 })
      .toArray();

    res.json({ success: true, data: bookings, count: bookings.length });
  } catch (error) {
    console.error('GET /api/bookings/guest/current error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch guest bookings' });
  }
});

// ============================================
// CREATE NEW BOOKING
// ============================================
router.post('/', protect, authorize('hotel_admin', 'super_admin', 'front_desk'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { guestName, roomNumber, roomType, checkIn, checkOut, guests, totalPrice, notes, specialRequests, paymentStatus } = req.body;

    // Validate required fields
    if (!guestName || !roomNumber || !checkIn || !checkOut) {
      return res.status(400).json({ 
        success: false, 
        error: 'guestName, roomNumber, checkIn, and checkOut are required' 
      });
    }

    // Validate dates
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    if (checkOutDate <= checkInDate) {
      return res.status(400).json({ success: false, error: 'Check-out must be after check-in' });
    }

    // Check if room exists and is available
    const room = await db.collection('rooms').findOne({ 
      hotelId, 
      number: parseInt(roomNumber) 
    });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    if (room.status !== 'Vacant') {
      return res.status(400).json({ 
        success: false, 
        error: 'Room is not available for these dates' 
      });
    }

    // Calculate total price if not provided
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const calculatedPrice = room.basePriceSAR ? room.basePriceSAR * nights : (totalPrice || 0);

    // Create booking
    const booking = {
      hotelId,
      guestName: guestName.trim(),
      roomNumber: parseInt(roomNumber),
      roomType: roomType || room.type,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guests: parseInt(guests) || 1,
      totalPrice: totalPrice ? parseFloat(totalPrice) : calculatedPrice,
      basePriceSAR: room.basePriceSAR || 0,
      nights: nights,
      notes: notes?.trim() || '',
      specialRequests: specialRequests || [],
      status: 'pending',
      paymentStatus: paymentStatus || 'pending',
      createdBy: req.user?.email || 'system',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('bookings').insertOne(booking);
    booking._id = result.insertedId;

    // Update room status if booking is confirmed
    if (booking.status === 'confirmed') {
      await db.collection('rooms').updateOne(
        { _id: room._id },
        { $set: { 
          status: 'Occupied', 
          guestName: booking.guestName, 
          updatedAt: new Date() 
        }}
      );
    }

    // Real-time broadcast
    broadcast(req, 'booking_new', booking);

    // Log the action
    await logAction(req, 'booking_created', `Booking #${booking._id} for ${booking.guestName} - Room ${booking.roomNumber}`);

    res.status(201).json({ 
      success: true, 
      message: 'Booking created successfully', 
      data: booking 
    });

  } catch (error) {
    console.error('POST /api/bookings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create booking' });
  }
});

// ============================================
// UPDATE BOOKING
// ============================================
router.put('/:id', protect, authorize('hotel_admin', 'super_admin', 'front_desk'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { status, paymentStatus, notes, specialRequests, checkIn, checkOut, guests, totalPrice } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid booking ID' });
    }

    // Fetch current booking
    const booking = await db.collection('bookings').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Build update object
    const updateData = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (notes !== undefined) updateData.notes = notes.trim();
    if (specialRequests !== undefined) updateData.specialRequests = specialRequests;
    if (checkIn) updateData.checkIn = new Date(checkIn);
    if (checkOut) updateData.checkOut = new Date(checkOut);
    if (guests !== undefined) updateData.guests = parseInt(guests);
    if (totalPrice !== undefined) updateData.totalPrice = parseFloat(totalPrice);

    // Handle status change effects on room
    const oldStatus = booking.status;
    const newStatus = status || oldStatus;

    if (newStatus !== oldStatus) {
      const room = await db.collection('rooms').findOne({ 
        hotelId, 
        number: booking.roomNumber 
      });

      if (room) {
        if (newStatus === 'confirmed' && oldStatus !== 'confirmed') {
          // Mark room as occupied
          await db.collection('rooms').updateOne(
            { _id: room._id },
            { $set: { 
              status: 'Occupied', 
              guestName: booking.guestName, 
              updatedAt: new Date() 
            }}
          );
        } else if (newStatus === 'cancelled' && oldStatus === 'confirmed') {
          // Free up the room
          await db.collection('rooms').updateOne(
            { _id: room._id },
            { $set: { 
              status: 'Vacant', 
              guestName: null, 
              updatedAt: new Date() 
            }}
          );
        } else if (newStatus === 'checked-out') {
          // Mark room as needs cleaning
          await db.collection('rooms').updateOne(
            { _id: room._id },
            { $set: { 
              status: 'Cleaning', 
              updatedAt: new Date() 
            }}
          );
        }
      }
    }

    const result = await db.collection('bookings').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Fetch updated booking
    const updatedBooking = await db.collection('bookings').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'booking_upd', updatedBooking);

    // Log the action
    await logAction(req, 'booking_updated', `Booking #${id} updated - Status: ${updatedBooking?.status}`);

    res.json({ 
      success: true, 
      message: 'Booking updated successfully', 
      data: updatedBooking 
    });

  } catch (error) {
    console.error('PUT /api/bookings/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update booking' });
  }
});

// ============================================
// DELETE BOOKING (Cancel)
// ============================================
router.delete('/:id', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid booking ID' });
    }

    // Fetch booking first for logging and room update
    const booking = await db.collection('bookings').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // If booking was confirmed, free up the room
    if (booking.status === 'confirmed') {
      await db.collection('rooms').updateOne(
        { hotelId, number: booking.roomNumber },
        { $set: { 
          status: 'Vacant', 
          guestName: null, 
          updatedAt: new Date() 
        }}
      );
    }

    // Soft delete: update status to cancelled instead of hard delete
    const result = await db.collection('bookings').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: { 
        status: 'cancelled', 
        cancelledAt: new Date(), 
        cancelledBy: req.user?.email || 'system',
        updatedAt: new Date() 
      }}
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Fetch updated booking for broadcast
    const cancelledBooking = await db.collection('bookings').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'booking_upd', cancelledBooking);

    // Log the action
    await logAction(req, 'booking_cancelled', `Booking #${id} cancelled for ${booking.guestName}`);

    res.json({ 
      success: true, 
      message: 'Booking cancelled successfully',
      data: { id, status: 'cancelled', guestName: booking.guestName }
    });

  } catch (error) {
    console.error('DELETE /api/bookings/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to cancel booking' });
  }
});

// ============================================
// CHECK ROOM AVAILABILITY (Utility)
// ============================================
router.post('/check-availability', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { roomNumber, checkIn, checkOut } = req.body;

    if (!roomNumber || !checkIn || !checkOut) {
      return res.status(400).json({ 
        success: false, 
        error: 'roomNumber, checkIn, and checkOut are required' 
      });
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Check for overlapping bookings
    const overlappingBooking = await db.collection('bookings').findOne({
      hotelId,
      roomNumber: parseInt(roomNumber),
      status: { $in: ['confirmed', 'checked-in'] },
      $or: [
        { checkIn: { $lt: checkOutDate }, checkOut: { $gt: checkInDate } }
      ]
    });

    const isAvailable = !overlappingBooking;

    res.json({ 
      success: true, 
      data: { 
        available: isAvailable, 
        roomNumber: parseInt(roomNumber),
        checkIn,
        checkOut,
        reason: overlappingBooking ? 'Room already booked for these dates' : null
      } 
    });

  } catch (error) {
    console.error('POST /api/bookings/check-availability error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to check availability' });
  }
});

// ============================================
// GET BOOKING STATS (For Dashboard)
// ============================================
router.get('/stats/summary', protect, checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('bookings').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { 
            $sum: { $cond: [{ $eq: ['$status', 'checked-out'] }, '$totalPrice', 0] } 
          }
        }
      }
    ]).toArray();

    // Format stats for frontend
    const summary = {
      total: 0,
      byStatus: {},
      totalRevenue: 0,
      pending: 0,
      confirmed: 0,
      checkedIn: 0,
      checkedOut: 0,
      cancelled: 0
    };

    stats.forEach(s => {
      summary.byStatus[s._id] = s.count;
      summary.total += s.count;
      summary.totalRevenue += s.totalRevenue || 0;
      if (s._id) summary[s._id.replace('-', '')] = s.count;
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('GET /api/bookings/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch booking stats' });
  }
});

// ============================================
// EXPORT BOOKINGS (For Reports)
// ============================================
router.get('/export', protect, authorize('hotel_admin', 'super_admin'), checkHotelAccess, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { dateFrom, dateTo, format = 'json' } = req.query;

    const filter = { hotelId };

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const bookings = await db.collection('bookings')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    if (format === 'csv') {
      // Simple CSV export
      const headers = ['ID', 'Guest', 'Room', 'CheckIn', 'CheckOut', 'Guests', 'TotalPrice', 'Status'];
      const rows = bookings.map(b => [
        b._id,
        b.guestName,
        b.roomNumber,
        b.checkIn?.toISOString().split('T')[0],
        b.checkOut?.toISOString().split('T')[0],
        b.guests,
        b.totalPrice,
        b.status
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=bookings-${hotelId}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=bookings-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: bookings });

  } catch (error) {
    console.error('GET /api/bookings/export error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to export bookings' });
  }
});

module.exports = router;
