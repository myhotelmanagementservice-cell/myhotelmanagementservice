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
// GET ALL STAFF (Multi-Tenant + Filters)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { department, status, shift, search } = req.query;

    // Build filter with multi-tenant isolation
    const filter = { hotelId };

    if (department) filter.department = department;
    if (status) filter.status = status;
    if (shift) filter.shift = shift;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } }
      ];
    }

    const staff = await db.collection('staff')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: staff, count: staff.length });
  } catch (error) {
    console.error('GET /api/staff error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch staff' });
  }
});

// ============================================
// GET SINGLE STAFF BY ID
// ============================================
router.get('/:id', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    const staff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    res.json({ success: true, data: staff });
  } catch (error) {
    console.error('GET /api/staff/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch staff' });
  }
});

// ============================================
// ADD NEW STAFF MEMBER
// ============================================
router.post('/', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { name, role, department, joinDate, shift, email, phone } = req.body;

    // Validate required fields
    if (!name || !role) {
      return res.status(400).json({ 
        success: false, 
        error: 'name and role are required' 
      });
    }

    // Create staff with hotel isolation
    const staff = {
      hotelId,
      name: name.trim(),
      role,
      department: department || 'General',
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      shift: shift || 'morning', // morning, evening, night
      status: 'online', // online, offline, on-duty, on-leave
      attendance: 'present', // present, absent, late
      rating: 5.0,
      tasks: 0,
      email: email || null,
      phone: phone || null,
      leaveRequest: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('staff').insertOne(staff);
    staff._id = result.insertedId;

    // Real-time broadcast
    broadcast(req, 'staff_new', staff);

    // Log the action
    await logAction(req, 'staff_created', `Staff "${name}" added as ${role}`);

    res.status(201).json({ 
      success: true, 
      message: 'Staff member added successfully', 
      data: staff 
    });

  } catch (error) {
    console.error('POST /api/staff error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to add staff' });
  }
});

// ============================================
// UPDATE STAFF MEMBER
// ============================================
router.put('/:id', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { name, role, department, joinDate, shift, status, attendance, rating, tasks, leaveRequest } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    // Fetch current staff
    const currentStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!currentStaff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    // Build update object
    const updateData = { updatedAt: new Date() };

    if (name !== undefined) updateData.name = name.trim();
    if (role) updateData.role = role;
    if (department !== undefined) updateData.department = department;
    if (joinDate) updateData.joinDate = new Date(joinDate);
    if (shift) updateData.shift = shift;
    if (status) updateData.status = status;
    if (attendance !== undefined) updateData.attendance = attendance;
    if (rating !== undefined) updateData.rating = parseFloat(rating);
    if (tasks !== undefined) updateData.tasks = parseInt(tasks);
    if (leaveRequest !== undefined) updateData.leaveRequest = leaveRequest;

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    // Fetch updated staff
    const updatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'staff_upd', updatedStaff);

    // Log the action
    await logAction(req, 'staff_updated', `Staff "${updatedStaff?.name}" updated`);

    res.json({ 
      success: true, 
      message: 'Staff updated successfully', 
      data: updatedStaff 
    });

  } catch (error) {
    console.error('PUT /api/staff/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update staff' });
  }
});

// ============================================
// DELETE STAFF (Soft Delete - Deactivate)
// ============================================
router.delete('/:id', protect, authorize('super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    // Fetch staff first for logging
    const staff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    // Soft delete: update status to inactive instead of hard delete
    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { 
        $set: { 
          status: 'inactive', 
          deletedAt: new Date(), 
          deletedBy: req.user?.email || 'system',
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    // Fetch updated staff for broadcast
    const deactivatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'staff_upd', deactivatedStaff);

    // Log the action
    await logAction(req, 'staff_deactivated', `Staff "${staff.name}" deactivated`);

    res.json({ 
      success: true, 
      message: 'Staff deactivated successfully',
      data: { id, name: staff.name, status: 'inactive' }
    });

  } catch (error) {
    console.error('DELETE /api/staff/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate staff' });
  }
});

// ============================================
// MARK ATTENDANCE (Quick attendance update)
// ============================================
router.post('/:id/attendance', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { attendance, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    if (!attendance || !['present', 'absent', 'late'].includes(attendance)) {
      return res.status(400).json({ success: false, error: 'Valid attendance status is required' });
    }

    const updateData = {
      attendance,
      updatedAt: new Date(),
      $push: {}
    };

    if (notes) {
      updateData.$push.attendanceLog = { 
        status: attendance, 
        notes: notes.trim(), 
        by: req.user?.email || 'system', 
        timestamp: new Date() 
      };
    }

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ... (updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const updatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'staff_upd', updatedStaff);

    // Log the action
    await logAction(req, 'attendance_marked', `Staff "${updatedStaff?.name}" marked as ${attendance}`);

    res.json({ 
      success: true, 
      message: 'Attendance updated successfully',
      data: updatedStaff 
    });

  } catch (error) {
    console.error('POST /api/staff/:id/attendance error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update attendance' });
  }
});

// ============================================
// UPDATE STAFF STATUS (Online/Offline/On-Duty/On-Leave)
// ============================================
router.post('/:id/status', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { status, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    if (!status || !['online', 'offline', 'on-duty', 'on-leave', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status is required' });
    }

    const updateData = {
      status,
      updatedAt: new Date(),
      $push: {}
    };

    if (notes) {
      updateData.$push.statusLog = { 
        status, 
        notes: notes.trim(), 
        by: req.user?.email || 'system', 
        timestamp: new Date() 
      };
    }

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ... (updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const updatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'staff_upd', updatedStaff);

    // Log the action
    await logAction(req, 'status_updated', `Staff "${updatedStaff?.name}" status changed to ${status}`);

    res.json({ 
      success: true, 
      message: 'Status updated successfully',
      data: updatedStaff 
    });

  } catch (error) {
    console.error('POST /api/staff/:id/status error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update staff status' });
  }
});

// ============================================
// SUBMIT LEAVE REQUEST (By staff)
// ============================================
router.post('/:id/leave-request', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { reason, startDate, endDate } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    if (!reason || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'reason, startDate, and endDate are required' });
    }

    const leaveRequest = {
      reason: reason.trim(),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: 'pending',
      requestedAt: new Date(),
      requestedBy: req.user?.email || 'system'
    };

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { 
        $set: { 
          leaveRequest,
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const updatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast to admins
    broadcast(req, 'staff_leave_request', { 
      staffId: id, 
      name: updatedStaff.name, 
      leaveRequest 
    });

    // Log the action
    await logAction(req, 'leave_requested', `Staff "${updatedStaff.name}" requested leave: ${reason}`);

    res.json({ 
      success: true, 
      message: 'Leave request submitted successfully',
      data: updatedStaff 
    });

  } catch (error) {
    console.error('POST /api/staff/:id/leave-request error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to submit leave request' });
  }
});

// ============================================
// APPROVE/REJECT LEAVE REQUEST (Admin only)
// ============================================
router.post('/:id/leave-decision', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { decision, notes } = req.body; // decision: 'approved' or 'rejected'

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID' });
    }

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'Valid decision is required' });
    }

    const staff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!staff || !staff.leaveRequest) {
      return res.status(404).json({ success: false, error: 'Staff or leave request not found' });
    }

    const updateData = {
      updatedAt: new Date(),
      'leaveRequest.status': decision,
      'leaveRequest.decidedAt': new Date(),
      'leaveRequest.decidedBy': req.user?.email || 'system'
    };

    if (notes) {
      updateData['leaveRequest.adminNotes'] = notes.trim();
    }

    // If approved, update staff status to on-leave
    if (decision === 'approved') {
      updateData.status = 'on-leave';
    }

    const result = await db.collection('staff').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const updatedStaff = await db.collection('staff').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'staff_upd', updatedStaff);

    // Log the action
    await logAction(req, 'leave_decision', `Leave ${decision} for staff "${staff.name}"`);

    res.json({ 
      success: true, 
      message: `Leave request ${decision} successfully`,
      data: updatedStaff 
    });

  } catch (error) {
    console.error('POST /api/staff/:id/leave-decision error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to process leave decision' });
  }
});

// ============================================
// GET STAFF STATS (For Dashboard)
// ============================================
router.get('/stats/summary', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('staff').aggregate([
      { $match: { hotelId, status: { $ne: 'inactive' } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          byStatus: {
            $push: { status: '$status', count: 1 }
          },
          byDepartment: {
            $push: { department: '$department', count: 1 }
          },
          byShift: {
            $push: { shift: '$shift', count: 1 }
          },
          avgRating: { $avg: '$rating' },
          totalTasks: { $sum: '$tasks' },
          presentToday: {
            $sum: { $cond: [{ $eq: ['$attendance', 'present'] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const result = stats[0] || { 
      total: 0, 
      byStatus: [], 
      byDepartment: [], 
      byShift: [],
      avgRating: 0,
      totalTasks: 0,
      presentToday: 0
    };

    // Format for frontend
    const summary = {
      total: result.total,
      byStatus: {},
      byDepartment: {},
      byShift: {},
      avgRating: result.avgRating?.toFixed(1) || '0.0',
      totalTasks: result.totalTasks,
      presentToday: result.presentToday,
      attendanceRate: result.total > 0 ? ((result.presentToday / result.total) * 100).toFixed(1) : '0'
    };

    result.byStatus.forEach(s => { summary.byStatus[s.status] = s.count; });
    result.byDepartment.forEach(d => { summary.byDepartment[d.department] = d.count; });
    result.byShift.forEach(sh => { summary.byShift[sh.shift] = sh.count; });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('GET /api/staff/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch staff stats' });
  }
});

// ============================================
// EXPORT STAFF LIST (For Reports)
// ============================================
router.get('/export', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { department, status, format = 'json' } = req.query;

    const filter = { hotelId };

    if (department) filter.department = department;
    if (status) filter.status = status;

    const staff = await db.collection('staff')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    if (format === 'csv') {
      // Simple CSV export
      const headers = ['Name', 'Role', 'Department', 'Shift', 'Status', 'Attendance', 'Rating', 'Tasks', 'Join Date'];
      const rows = staff.map(s => [
        s.name,
        s.role,
        s.department,
        s.shift,
        s.status,
        s.attendance,
        s.rating,
        s.tasks,
        s.joinDate ? new Date(s.joinDate).toISOString().split('T')[0] : ''
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=staff-${hotelId}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=staff-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: staff });

  } catch (error) {
    console.error('GET /api/staff/export error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to export staff' });
  }
});

module.exports = router;