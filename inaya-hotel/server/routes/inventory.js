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
// GET ALL INVENTORY ITEMS (Multi-Tenant)
// ============================================
router.get('/', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { category, lowStock, search } = req.query;

    // Build filter with multi-tenant isolation
    const filter = { hotelId };
    if (category) filter.category = category;
    if (lowStock === 'true') filter.stock = { $lte: { $ifNull: ['$min', 10] } };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await db.collection('inventory')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    // Add stock status field for frontend
    const itemsWithStatus = items.map(item => ({
      ...item,
      stockStatus: item.stock <= 0 ? 'out-of-stock' : 
                   item.stock <= (item.min || 10) ? 'low-stock' : 'in-stock'
    }));

    res.json({ 
      success: true, 
      data: itemsWithStatus, 
      count: itemsWithStatus.length 
    });
  } catch (error) {
    console.error('GET /api/inventory error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
  }
});

// ============================================
// GET SINGLE INVENTORY ITEM
// ============================================
router.get('/:id', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid inventory ID' });
    }

    const item = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('GET /api/inventory/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch item' });
  }
});

// ============================================
// ADD NEW INVENTORY ITEM
// ============================================
router.post('/', protect, authorize('hotel_admin', 'super_admin', 'inventory_manager'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { name, category, stock, unit, min, price } = req.body;

    // Validate required fields
    if (!name || !category || stock === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'name, category, and stock are required' 
      });
    }

    // Create inventory item with hotel isolation
    const item = {
      hotelId,
      name: name.trim(),
      category: category.trim(),
      stock: parseInt(stock),
      unit: unit || 'pcs',
      min: parseInt(min) || 10,
      price: price ? parseFloat(price) : 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('inventory').insertOne(item);
    item._id = result.insertedId;

    // Real-time broadcast
    broadcast(req, 'inventory_added', item);

    // Log the action
    await logAction(req, 'inventory_created', `Item "${name}" added with stock: ${stock}`);

    // Check low stock alert
    if (item.stock <= item.min) {
      broadcast(req, 'alert_low_stock', { 
        item: item.name, 
        stock: item.stock, 
        min: item.min 
      });
    }

    res.status(201).json({ 
      success: true, 
      message: 'Item added to inventory', 
      data: item 
    });

  } catch (error) {
    console.error('POST /api/inventory error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to add inventory item' });
  }
});

// ============================================
// UPDATE INVENTORY ITEM
// ============================================
router.put('/:id', protect, authorize('hotel_admin', 'super_admin', 'inventory_manager'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { name, category, stock, unit, min, price } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid inventory ID' });
    }

    // Fetch current item
    const currentItem = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Build update object
    const updateData = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (category !== undefined) updateData.category = category.trim();
    if (stock !== undefined) updateData.stock = parseInt(stock);
    if (unit !== undefined) updateData.unit = unit;
    if (min !== undefined) updateData.min = parseInt(min);
    if (price !== undefined) updateData.price = parseFloat(price);

    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id), hotelId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Fetch updated item
    const updatedItem = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'inventory_upd', updatedItem);

    // Log the action
    await logAction(req, 'inventory_updated', `Item "${updatedItem?.name}" updated`);

    // Check low stock alert if stock changed
    if (stock !== undefined && updatedItem.stock <= updatedItem.min) {
      broadcast(req, 'alert_low_stock', { 
        item: updatedItem.name, 
        stock: updatedItem.stock, 
        min: updatedItem.min 
      });
    }

    res.json({ 
      success: true, 
      message: 'Item updated successfully', 
      data: updatedItem 
    });

  } catch (error) {
    console.error('PUT /api/inventory/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update inventory item' });
  }
});

// ============================================
// DELETE INVENTORY ITEM
// ============================================
router.delete('/:id', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid inventory ID' });
    }

    // Fetch item first for logging
    const item = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const result = await db.collection('inventory').deleteOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Real-time broadcast
    broadcast(req, 'inventory_deleted', { 
      id, 
      hotelId, 
      name: item.name 
    });

    // Log the action
    await logAction(req, 'inventory_deleted', `Item "${item.name}" deleted`);

    res.json({ 
      success: true, 
      message: 'Item deleted successfully',
      data: { id, name: item.name }
    });

  } catch (error) {
    console.error('DELETE /api/inventory/:id error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete inventory item' });
  }
});

// ============================================
// ADJUST STOCK (Quick +/- adjustment)
// ============================================
router.post('/:id/adjust', protect, authorize('hotel_admin', 'super_admin', 'inventory_manager', 'housekeeping'), async (req, res) => {
  try {
    const db = getDB(req);
    const { id } = req.params;
    const hotelId = req.hotelId;
    const { delta, reason } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid inventory ID' });
    }

    if (delta === undefined || isNaN(parseInt(delta))) {
      return res.status(400).json({ success: false, error: 'Valid delta (number) is required' });
    }

    const item = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id), 
      hotelId 
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const newStock = Math.max(0, item.stock + parseInt(delta));

    const result = await db.collection('inventory').updateOne(
      { _id: new ObjectId(id), hotelId },
      { 
        $set: { 
          stock: newStock, 
          updatedAt: new Date(),
          lastAdjusted: new Date(),
          adjustedBy: req.user?.email || 'system',
          adjustReason: reason || ''
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const updatedItem = await db.collection('inventory').findOne({ 
      _id: new ObjectId(id) 
    });

    // Real-time broadcast
    broadcast(req, 'inventory_upd', updatedItem);

    // Log the adjustment
    await logAction(req, 'stock_adjusted', 
      `Item "${item.name}": ${item.stock} → ${newStock} (${delta >= 0 ? '+' : ''}${delta}) - ${reason || 'No reason'}`
    );

    // Check low stock alert
    if (newStock <= item.min) {
      broadcast(req, 'alert_low_stock', { 
        item: item.name, 
        stock: newStock, 
        min: item.min,
        message: `Low stock alert: ${item.name} has only ${newStock} ${item.unit} left`
      });
    }

    res.json({ 
      success: true, 
      message: `Stock adjusted: ${item.stock} → ${newStock}`,
      data: updatedItem 
    });

  } catch (error) {
    console.error('POST /api/inventory/:id/adjust error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to adjust stock' });
  }
});

// ============================================
// GET INVENTORY STATS (For Dashboard)
// ============================================
router.get('/stats/summary', protect, async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;

    const stats = await db.collection('inventory').aggregate([
      { $match: { hotelId } },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalValue: { $sum: { $multiply: ['$stock', '$price'] } },
          lowStockCount: { 
            $sum: { $cond: [{ $lte: ['$stock', { $ifNull: ['$min', 10] }] }, 1, 0] } 
          },
          outOfStockCount: { 
            $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } 
          },
          byCategory: {
            $push: { 
              category: '$category', 
              count: 1,
              totalStock: '$stock'
            }
          }
        }
      }
    ]).toArray();

    const result = stats[0] || { 
      totalItems: 0, 
      totalValue: 0, 
      lowStockCount: 0, 
      outOfStockCount: 0,
      byCategory: []
    };

    // Aggregate by category
    const categoryStats = {};
    result.byCategory.forEach(cat => {
      if (!categoryStats[cat.category]) {
        categoryStats[cat.category] = { count: 0, totalStock: 0 };
      }
      categoryStats[cat.category].count += cat.count;
      categoryStats[cat.category].totalStock += cat.totalStock;
    });

    res.json({ 
      success: true, 
      data: {
        totalItems: result.totalItems,
        totalValue: result.totalValue,
        lowStockCount: result.lowStockCount,
        outOfStockCount: result.outOfStockCount,
        categories: categoryStats
      } 
    });
  } catch (error) {
    console.error('GET /api/inventory/stats/summary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch inventory stats' });
  }
});

// ============================================
// EXPORT INVENTORY (For Reports)
// ============================================
router.get('/export', protect, authorize('hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const db = getDB(req);
    const hotelId = req.hotelId;
    const { category, format = 'json' } = req.query;

    const filter = { hotelId };
    if (category) filter.category = category;

    const items = await db.collection('inventory')
      .find(filter)
      .sort({ name: 1 })
      .toArray();

    if (format === 'csv') {
      // Simple CSV export
      const headers = ['Name', 'Category', 'Stock', 'Unit', 'Min', 'Price', 'Status'];
      const rows = items.map(item => [
        item.name,
        item.category,
        item.stock,
        item.unit,
        item.min,
        item.price,
        item.stock <= 0 ? 'Out of Stock' : 
        item.stock <= item.min ? 'Low Stock' : 'In Stock'
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=inventory-${hotelId}-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // Default JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=inventory-${hotelId}-${new Date().toISOString().split('T')[0]}.json`);
    res.json({ success: true, data: items });

  } catch (error) {
    console.error('GET /api/inventory/export error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to export inventory' });
  }
});

module.exports = router;
