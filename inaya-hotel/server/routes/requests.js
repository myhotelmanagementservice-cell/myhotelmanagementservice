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
// GET ALL REQUESTS (Multi-Tenant + Filters)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, priority, department, guestName, dateFrom, dateTo, limit = 50, page = 1 } = req.query;

    // Build filter with multi-tenant isolation
    const filter = { hotelId };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (department) filter.department = department;
    if (guestName) filter.guestName = { $regex: guestName, $options: 'i' };

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      db.collection('requests')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      db.collection('requests').countDocuments(filter)
    ]);

    res.json({ 
      success: true, 
      data: requests, 
      count: requests.length,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('GET /api/requests error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch requests' });
  }
});

// ============================================
// GET SINGLE REQUEST BY ID
// ============================================
router.get('/:id', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    const request = await db.collection('requests').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    res.json({ success: true, data: request });
  } catch (error) {
    console.error('GET /api/requests/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch request' });
  }
});

// ============================================
// GET REQUESTS FOR CURRENT GUEST
// ============================================
router.get('/guest/my-requests', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const guestName = req.user?.name || req.query.guestName;
    const roomNumber = req.user?.room || req.query.roomNumber;

    if (!guestName && !roomNumber) {
      return res.status(400).json({ success: false, error: 'Guest name or room number required' });
    }

    const filter = { hotelId };
    if (guestName) filter.guestName = guestName;
    if (roomNumber) filter.roomNumber = parseInt(roomNumber);

    const requests = await db.collection('requests')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: requests, count: requests.length });
  } catch (error) {
    console.error('GET /api/requests/guest/my-requests error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch guest requests' });
  }
});

// ============================================
// CREATE NEW REQUEST (Guest or Admin)
// ============================================
router.post('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { guestName, roomNumber, department, category, description, priority, type, items, totalPrice } = req.body;

    // Validate required fields
    if (!guestName || !roomNumber || !department) {
      return res.status(400).json({ 
        success: false, 
        error: 'guestName, roomNumber, and department are required' 
      });
    }

    // Create request with hotel isolation
    const request = {
      hotelId,
      guestName: guestName.trim(),
      roomNumber: parseInt(roomNumber),
      department,
      category: category || 'General',
      description: description?.trim() || '',
      priority: priority || 'normal', // normal, urgent, emergency
      status: 'open', // open, in_progress, completed, cancelled
      type: type || 'service', // service, complaint, feedback
      items: items || [],
      totalPrice: totalPrice ? parseFloat(totalPrice) : 0,
      assignedTo: null,
      adminReply: null,
      adminReplyTime: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('requests').insertOne(request);
    request._id = result.insertedId;

    // Real-time broadcast to all clients in this hotel
    broadcast(req, 'req_new', request);

    // Log the action
    await logAction(req, 'request_created', `Request #${request._id} by ${guestName} - ${department}`);

    // Send emergency alert if priority is emergency
    if (priority === 'emergency') {
      broadcast(req, 'alert_emergency', {
        message: `🚨 Emergency request from Room ${roomNumber}: ${description}`,
        request
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Request submitted successfully', 
      data: request 
    });

  } catch (error) {
    console.error('POST /api/requests error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create request' });
  }
});

// ============================================
// UPDATE REQUEST (Status, Assignment, Reply)
// ============================================
router.put('/:id', protect, authorize('hotel_admin', 'super_admin', 'staff'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { status, priority, assignedTo, adminReply, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    // Fetch current request
    const currentRequest = await db.collection('requests').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!currentRequest) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Build update object
    const updateData = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;

    if (adminReply !== undefined) {
      updateData.adminReply = adminReply.trim();
      updateData.adminReplyTime = new Date();
    }

    if (notes) {
      // Append note to history
      updateData.$push = {
        notes: {
          text: notes.trim(),
          by: req.user?.email || 'system',
          timestamp: new Date()
        }
      };
    }

    const result = await db.collection('requests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ...(updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Fetch updated request
    const updatedRequest = await db.collection('requests').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'req_upd', updatedRequest);

    // Log the action
    await logAction(req, 'request_updated', `Request #${id} - Status: ${status || currentRequest.status}`);

    res.json({ 
      success: true, 
      message: 'Request updated successfully', 
      data: updatedRequest 
    });

  } catch (error) {
    console.error('PUT /api/requests/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update request' });
  }
});

// ============================================
// DELETE REQUEST (Soft Delete - Cancel)
// ============================================
router.delete('/:id', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    // Fetch request first for logging
    const request = await db.collection('requests').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Soft delete: update status to cancelled
    const result = await db.collection('requests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { 
        $set: { 
          status: 'cancelled', 
          cancelledAt: new Date(), 
          cancelledBy: req.user?.email || 'system',
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Fetch updated request for broadcast
    const cancelledRequest = await db.collection('requests').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'req_upd', cancelledRequest);

    // Log the action
    await logAction(req, 'request_cancelled', `Request #${id} cancelled by ${req.user?.email}`);

    res.json({ 
      success: true, 
      message: 'Request cancelled successfully',
      data: { id, status: 'cancelled', guestName: request.guestName }
    });

  } catch (error) {
    console.error('DELETE /api/requests/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to cancel request' });
  }
});

// ============================================
// ADD ADMIN REPLY TO REQUEST
// ============================================
router.post('/:id/reply', protect, authorize('hotel_admin', 'super_admin', 'staff'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { reply } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    if (!reply || !reply.trim()) {
      return res.status(400).json({ success: false, error: 'Reply content is required' });
    }

    const result = await db.collection('requests').updateOne(
      { _id: new ObjectId(id), hotelId },
      { 
        $set: { 
          adminReply: reply.trim(), 
          adminReplyTime: new Date(),
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const updatedRequest = await db.collection('requests').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'req_upd', updatedRequest);

    // Log the action
    await logAction(req, 'admin_reply', `Reply to Request #${id} by ${req.user?.email}`);

    res.json({ 
      success: true, 
      message: 'Reply sent successfully',
      data: updatedRequest 
    });

  } catch (error) {
    console.error('POST /api/requests/:id/reply error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to send reply' });
  }
});

// ============================================
// GET REQUEST STATS (For Dashboard)
// ============================================
router.get('/stats/summary', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('requests').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          byPriority: {
            $push: { priority: '$priority', count: 1 }
          },
          byDepartment: {
            $push: { department: '$department', count: 1 }
          }
        }
      }
    ]).toArray();

    // Format stats for frontend
    const summary = {
      total: 0,
      byStatus: {},
      byPriority: { normal: 0, urgent: 0, emergency: 0 },
      byDepartment: {},
      open: 0,
      inProgress: 0,
      completed: 0,
      emergency: 0
    };

    stats.forEach(s => {
      summary.byStatus[s._id] = s.count;
      summary.total += s.count;
      if (s._id === 'open') summary.open = s.count;
      if (s._id === 'in_progress') summary.inProgress = s.count;
      if (s._id === 'completed') summary.completed = s.count;

      s.byPriority.forEach(p => {
        if (summary.byPriority[p.priority] !== undefined) {
          summary.byPriority[p.priority] += p.count;
        }
      });

      s.byDepartment.forEach(d => {
        if (!summary.byDepartment[d.department]) {
          summary.byDepartment[d.department] = 0;
        }
        summary.byDepartment[d.department] += d.count;
      });
    });

    // Count emergency requests that are not completed
    summary.emergency = await db.collection('requests').countDocuments({
      hotelId,
      priority: 'emergency',
      status: { $ne: 'completed' }
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('GET /api/requests/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch request stats' });
  }
});

// ============================================
// EXPORT REQUESTS (For Reports)
// ============================================
router.get('/export', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, department, dateFrom, dateTo, format = 'json' } = req.query;

    const filter = { hotelId };

    if (status) filter.status = status;
    if (department) filter.department = department;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const requests = await db.collection('requests')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    if (format === 'csv') {
      // Simple CSV export
      const headers = ['ID', 'Guest', 'Room', 'Department', 'Description', 'Priority', 'Status', 'Created'];
      const rows = requests.map(r => [
        r._id,
        r.guestName,
        r.roomNumber,
        r.department,
        r.description.replace(/,/g, ';'),
        r.priority,
        r.status,
        new Date(r.createdAt).toISOString().split('T')[0]
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=requests-${hotelId}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=requests-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: requests });

  } catch (error) {
    console.error('GET /api/requests/export error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to export requests' });
  }
});

module.exports = router;
