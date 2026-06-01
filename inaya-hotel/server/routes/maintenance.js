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
// GET ALL MAINTENANCE TASKS (Multi-Tenant)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, priority, assigned, area } = req.query;

    // Build filter with multi-tenant isolation
    const filter = { hotelId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assigned) filter.assignedTo = assigned;
    if (area) filter.area = { $regex: area, $options: 'i' };

    const tasks = await db.collection('maintenance')
      .find(filter)
      .sort({ scheduled: 1, priority: -1 })
      .toArray();

    res.json({ success: true, data: tasks, count: tasks.length });
  } catch (error) {
    console.error('GET /api/maintenance error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch maintenance tasks' });
  }
});

// ============================================
// GET SINGLE MAINTENANCE TASK
// ============================================
router.get('/:id', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID' });
    }

    const task = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    console.error('GET /api/maintenance/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch task' });
  }
});

// ============================================
// CREATE NEW MAINTENANCE TASK
// ============================================
router.post('/', protect, authorize('hotel_admin', 'super_admin', 'maintenance'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { task, area, description, priority, scheduled, assignedTo, estimatedHours } = req.body;

    // Validate required fields
    if (!task || !area) {
      return res.status(400).json({ 
        success: false, 
        error: 'task name and area are required' 
      });
    }

    // Create maintenance task with hotel isolation
    const newTask = {
      hotelId,
      task: task.trim(),
      area: area.trim(),
      description: description?.trim() || '',
      priority: priority || 'medium', // low, medium, high, critical
      status: 'pending', // pending, in_progress, completed, cancelled
      scheduled: scheduled ? new Date(scheduled) : null,
      assignedTo: assignedTo || null,
      estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
      actualHours: null,
      completedAt: null,
      notes: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('maintenance').insertOne(newTask);
    newTask._id = result.insertedId;

    // Real-time broadcast
    broadcast(req, 'maintenance_new', newTask);

    // Log the action
    await logAction(req, 'maintenance_created', `Task "${task}" created for ${area}`);

    res.status(201).json({ 
      success: true, 
      message: 'Maintenance task created', 
      data: newTask 
    });

  } catch (error) {
    console.error('POST /api/maintenance error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create maintenance task' });
  }
});

// ============================================
// UPDATE MAINTENANCE TASK
// ============================================
router.put('/:id', protect, authorize('hotel_admin', 'super_admin', 'maintenance'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { task, area, description, priority, scheduled, assignedTo, status, notes, actualHours } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID' });
    }

    // Fetch current task
    const currentTask = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!currentTask) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Build update object
    const updateData = { updatedAt: new Date() };

    if (task !== undefined) updateData.task = task.trim();
    if (area !== undefined) updateData.area = area.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (priority) updateData.priority = priority;
    if (scheduled) updateData.scheduled = new Date(scheduled);
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
    if (status) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.completedAt = new Date();
      }
    }
    if (actualHours !== undefined) updateData.actualHours = parseFloat(actualHours);
    if (notes) {
      // Append new note with timestamp
      updateData.$push = { 
        notes: { 
          text: notes, 
          by: req.user?.email || 'system', 
          timestamp: new Date() 
        } 
      };
    }

    const result = await db.collection('maintenance').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ... (updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Fetch updated task
    const updatedTask = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'maintenance_upd', updatedTask);

    // Log the action
    await logAction(req, 'maintenance_updated', `Task "${updatedTask?.task}" updated - Status: ${updatedTask?.status}`);

    res.json({ 
      success: true, 
      message: 'Task updated successfully', 
      data: updatedTask 
    });

  } catch (error) {
    console.error('PUT /api/maintenance/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update maintenance task' });
  }
});

// ============================================
// DELETE MAINTENANCE TASK (Soft Delete)
// ============================================
router.delete('/:id', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID' });
    }

    // Fetch task first for logging
    const task = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Soft delete: update status to cancelled instead of hard delete
    const result = await db.collection('maintenance').updateOne(
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
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Fetch updated task for broadcast
    const cancelledTask = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'maintenance_upd', cancelledTask);

    // Log the action
    await logAction(req, 'maintenance_cancelled', `Task "${task.task}" cancelled`);

    res.json({ 
      success: true, 
      message: 'Task cancelled successfully',
      data: { id, task: task.task, status: 'cancelled' }
    });

  } catch (error) {
    console.error('DELETE /api/maintenance/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to cancel maintenance task' });
  }
});

// ============================================
// ASSIGN TASK TO STAFF
// ============================================
router.post('/:id/assign', protect, authorize('hotel_admin', 'super_admin', 'maintenance'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { assignedTo, priority, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID' });
    }

    if (!assignedTo) {
      return res.status(400).json({ success: false, error: 'assignedTo is required' });
    }

    const updateData = {
      assignedTo,
      updatedAt: new Date(),
      $push: {}
    };

    if (priority) updateData.priority = priority;
    if (notes) {
      updateData.$push.notes = { 
        text: notes, 
        by: req.user?.email || 'system', 
        timestamp: new Date() 
      };
    }

    const result = await db.collection('maintenance').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ... (updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const updatedTask = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'maintenance_upd', updatedTask);

    // Log the action
    await logAction(req, 'task_assigned', `Task "${updatedTask?.task}" assigned to ${assignedTo}`);

    res.json({ 
      success: true, 
      message: 'Task assigned successfully',
      data: updatedTask 
    });

  } catch (error) {
    console.error('POST /api/maintenance/:id/assign error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to assign task' });
  }
});

// ============================================
// UPDATE TASK STATUS
// ============================================
router.post('/:id/status', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { status, notes } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID' });
    }

    if (!status || !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status is required' });
    }

    const updateData = {
      status,
      updatedAt: new Date(),
      $push: {}
    };

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    if (notes) {
      updateData.$push.notes = { 
        text: notes, 
        by: req.user?.email || 'system', 
        timestamp: new Date() 
      };
    }

    const result = await db.collection('maintenance').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData, ... (updateData.$push ? { $push: updateData.$push } : {}) }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const updatedTask = await db.collection('maintenance').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'maintenance_upd', updatedTask);

    // Log the action
    await logAction(req, 'status_updated', `Task "${updatedTask?.task}" status changed to ${status}`);

    res.json({ 
      success: true, 
      message: 'Status updated successfully',
      data: updatedTask 
    });

  } catch (error) {
    console.error('POST /api/maintenance/:id/status error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update task status' });
  }
});

// ============================================
// GET MAINTENANCE STATS (For Dashboard)
// ============================================
router.get('/stats/summary', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('maintenance').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          byPriority: {
            $push: { priority: '$priority', count: 1 }
          }
        }
      }
    ]).toArray();

    // Format stats for frontend
    const summary = {
      total: 0,
      byStatus: {},
      byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0
    };

    stats.forEach(s => {
      summary.byStatus[s._id] = s.count;
      summary.total += s.count;
      if (s._id) summary[s._id.replace('_', '')] = s.count;
      s.byPriority.forEach(p => {
        if (summary.byPriority[p.priority] !== undefined) {
          summary.byPriority[p.priority] += p.count;
        }
      });
    });

    // Get overdue tasks count
    const overdueCount = await db.collection('maintenance').countDocuments({
      hotelId,
      status: { $in: ['pending', 'in_progress'] },
      scheduled: { $lt: new Date() }
    });

    summary.overdue = overdueCount;

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('GET /api/maintenance/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch maintenance stats' });
  }
});

// ============================================
// EXPORT MAINTENANCE TASKS (For Reports)
// ============================================
router.get('/export', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { status, dateFrom, dateTo, format = 'json' } = req.query;

    const filter = { hotelId };

    if (status) filter.status = status;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const tasks = await db.collection('maintenance')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    if (format === 'csv') {
      // Simple CSV export
      const headers = ['Task', 'Area', 'Priority', 'Status', 'Assigned', 'Scheduled', 'Created'];
      const rows = tasks.map(t => [
        t.task,
        t.area,
        t.priority,
        t.status,
        t.assignedTo || 'Unassigned',
        t.scheduled ? new Date(t.scheduled).toISOString().split('T')[0] : '',
        new Date(t.createdAt).toISOString().split('T')[0]
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=maintenance-${hotelId}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=maintenance-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: tasks });

  } catch (error) {
    console.error('GET /api/maintenance/export error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to export maintenance tasks' });
  }
});

module.exports = router;
