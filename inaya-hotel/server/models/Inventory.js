const mongoose = require('mongoose');

// ============================================
// INVENTORY SCHEMA - Hotel Inventory Management
// ============================================

const inventorySchema = new mongoose.Schema({
    // Multi-tenant support
    hotelId: {
        type: String,
        required: [true, 'Hotel ID is required'],
        index: true
    },

    // Basic Item Information
    itemId: {
        type: String,
        unique: true,
        default: function() {
            return 'INV' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        }
    },
    itemName: {
        type: String,
        required: [true, 'Item name is required'],
        trim: true,
        index: true
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: ['linen', 'towel', 'toiletries', 'furniture', 'electronics', 'kitchen', 'cleaning', 'food_beverage', 'stationery', 'maintenance', 'other'],
        index: true
    },
    subCategory: {
        type: String,
        default: ''
    },

    // Quantity Management
    quantity: {
        type: Number,
        required: [true, 'Quantity is required'],
        min: 0,
        default: 0
    },
    unit: {
        type: String,
        required: [true, 'Unit is required'],
        enum: ['pcs', 'kg', 'litre', 'bottle', 'pack', 'roll', 'set', 'box', 'pair', 'bundle'],
        default: 'pcs'
    },
    minStock: {
        type: Number,
        required: [true, 'Minimum stock level is required'],
        min: 0,
        default: 10
    },
    maxStock: {
        type: Number,
        min: 0,
        default: 100
    },
    reorderLevel: {
        type: Number,
        min: 0,
        default: 20
    },

    // Pricing
    unitPrice: {
        type: Number,
        min: 0,
        default: 0
    },
    totalValue: {
        type: Number,
        default: 0
    },
    currency: {
        type: String,
        default: 'USD'
    },

    // Supplier Information
    supplier: {
        name: { type: String, default: '' },
        contact: { type: String, default: '' },
        email: { type: String, default: '' },
        phone: { type: String, default: '' },
        address: { type: String, default: '' }
    },
    lastOrdered: {
        date: { type: Date, default: null },
        quantity: { type: Number, default: 0 },
        price: { type: Number, default: 0 }
    },

    // Status
    status: {
        type: String,
        enum: ['available', 'low_stock', 'out_of_stock', 'discontinued', 'damaged'],
        default: 'available'
    },
    isActive: {
        type: Boolean,
        default: true
    },

    // Location
    location: {
        warehouse: { type: String, default: '' },
        rack: { type: String, default: '' },
        shelf: { type: String, default: '' }
    },

    // Stock Movements
    stockMovements: [{
        type: {
            type: String,
            enum: ['in', 'out', 'adjustment', 'damage', 'return'],
            required: true
        },
        quantity: { type: Number, required: true },
        previousQuantity: { type: Number },
        newQuantity: { type: Number },
        reason: { type: String, default: '' },
        reference: { type: String, default: '' }, // Invoice number, request ID, etc.
        performedBy: { type: String, default: '' },
        performedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
    }],

    // Quality Control
    quality: {
        rating: { type: Number, min: 1, max: 5, default: 3 },
        condition: { type: String, enum: ['new', 'good', 'fair', 'poor', 'damaged'], default: 'new' },
        expiryDate: { type: Date, default: null },
        manufacturingDate: { type: Date, default: null },
        batchNumber: { type: String, default: '' }
    },

    // Images
    images: [{
        url: String,
        description: String,
        uploadedAt: { type: Date, default: Date.now }
    }],

    // Usage Tracking
    usageCount: {
        type: Number,
        default: 0
    },
    lastUsed: {
        type: Date,
        default: null
    },

    // Department Assignment
    assignedDepartment: {
        type: String,
        enum: ['housekeeping', 'maintenance', 'restaurant', 'laundry', 'front_desk', 'all'],
        default: 'all'
    },

    // Description
    description: {
        type: String,
        default: ''
    },
    notes: {
        type: String,
        default: ''
    },

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },

    // Soft Delete
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================
// INDEXES for better performance
// ============================================
inventorySchema.index({ hotelId: 1, itemName: 1 });
inventorySchema.index({ hotelId: 1, category: 1 });
inventorySchema.index({ hotelId: 1, status: 1 });
inventorySchema.index({ minStock: 1, quantity: 1 });
inventorySchema.index({ supplierName: 1 });
inventorySchema.index({ isActive: 1 });

// ============================================
// VIRTUAL FIELDS
// ============================================

// Check if item is low stock
inventorySchema.virtual('isLowStock').get(function() {
    return this.quantity <= this.minStock && this.quantity > 0;
});

// Check if item is out of stock
inventorySchema.virtual('isOutOfStock').get(function() {
    return this.quantity === 0;
});

// Check if item needs reorder
inventorySchema.virtual('needsReorder').get(function() {
    return this.quantity <= this.reorderLevel;
});

// Stock percentage
inventorySchema.virtual('stockPercentage').get(function() {
    if (this.maxStock === 0) return 100;
    return (this.quantity / this.maxStock) * 100;
});

// Stock status color
inventorySchema.virtual('stockStatusColor').get(function() {
    if (this.isOutOfStock) return '🔴';
    if (this.isLowStock) return '🟡';
    if (this.needsReorder) return '🟠';
    return '🟢';
});

// ============================================
// INSTANCE METHODS
// ============================================

// Add stock
inventorySchema.methods.addStock = async function(quantity, reason, performedBy, reference = '') {
    const previousQuantity = this.quantity;
    this.quantity += quantity;
    this.totalValue = this.quantity * this.unitPrice;
    this.updatedAt = new Date();

    this.stockMovements.push({
        type: 'in',
        quantity: quantity,
        previousQuantity: previousQuantity,
        newQuantity: this.quantity,
        reason: reason,
        reference: reference,
        performedBy: performedBy,
        notes: `Added ${quantity} ${this.unit}(s)`
    });

    await this.updateStatus();
    return await this.save();
};

// Remove stock
inventorySchema.methods.removeStock = async function(quantity, reason, performedBy, reference = '') {
    if (this.quantity < quantity) {
        throw new Error(`Insufficient stock. Available: ${this.quantity}, Requested: ${quantity}`);
    }

    const previousQuantity = this.quantity;
    this.quantity -= quantity;
    this.totalValue = this.quantity * this.unitPrice;
    this.updatedAt = new Date();

    this.stockMovements.push({
        type: 'out',
        quantity: quantity,
        previousQuantity: previousQuantity,
        newQuantity: this.quantity,
        reason: reason,
        reference: reference,
        performedBy: performedBy,
        notes: `Removed ${quantity} ${this.unit}(s)`
    });

    await this.updateStatus();
    return await this.save();
};

// Adjust stock (manual adjustment)
inventorySchema.methods.adjustStock = async function(newQuantity, reason, performedBy) {
    const previousQuantity = this.quantity;
    const difference = newQuantity - this.quantity;

    this.quantity = newQuantity;
    this.totalValue = this.quantity * this.unitPrice;
    this.updatedAt = new Date();

    this.stockMovements.push({
        type: 'adjustment',
        quantity: Math.abs(difference),
        previousQuantity: previousQuantity,
        newQuantity: this.quantity,
        reason: reason,
        performedBy: performedBy,
        notes: `Adjusted from ${previousQuantity} to ${newQuantity}`
    });

    await this.updateStatus();
    return await this.save();
};

// Mark as damaged
inventorySchema.methods.markDamaged = async function(quantity, reason, performedBy) {
    if (quantity > this.quantity) {
        quantity = this.quantity;
    }

    const previousQuantity = this.quantity;
    this.quantity -= quantity;
    this.totalValue = this.quantity * this.unitPrice;
    this.updatedAt = new Date();

    this.stockMovements.push({
        type: 'damage',
        quantity: quantity,
        previousQuantity: previousQuantity,
        newQuantity: this.quantity,
        reason: reason,
        performedBy: performedBy,
        notes: `Marked ${quantity} ${this.unit}(s) as damaged`
    });

    await this.updateStatus();
    return await this.save();
};

// Update status based on quantity
inventorySchema.methods.updateStatus = async function() {
    if (this.quantity === 0) {
        this.status = 'out_of_stock';
    } else if (this.quantity <= this.minStock) {
        this.status = 'low_stock';
    } else {
        this.status = 'available';
    }
    return this;
};

// Record usage
inventorySchema.methods.recordUsage = async function(quantity, department) {
    this.usageCount += quantity;
    this.lastUsed = new Date();
    return await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

// Get low stock items
inventorySchema.statics.getLowStockItems = function(hotelId, limit = 50) {
    return this.find({
        hotelId,
        isActive: true,
        quantity: { $lte: '$minStock' },
        status: { $ne: 'discontinued' }
    }).sort({ quantity: 1 }).limit(limit);
};

// Get items by category
inventorySchema.statics.getByCategory = function(hotelId, category) {
    return this.find({
        hotelId,
        category,
        isActive: true
    }).sort({ itemName: 1 });
};

// Get total inventory value
inventorySchema.statics.getTotalValue = async function(hotelId) {
    const result = await this.aggregate([
        { $match: { hotelId, isActive: true } },
        { $group: {
            _id: null,
            totalValue: { $sum: '$totalValue' },
            totalItems: { $sum: '$quantity' }
        }}
    ]);

    return result[0] || { totalValue: 0, totalItems: 0 };
};

// Get stock movement summary
inventorySchema.statics.getMovementSummary = async function(hotelId, days = 30) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const movements = await this.aggregate([
        { $match: { hotelId } },
        { $unwind: '$stockMovements' },
        { $match: { 'stockMovements.performedAt': { $gte: sinceDate } } },
        { $group: {
            _id: '$stockMovements.type',
            totalQuantity: { $sum: '$stockMovements.quantity' },
            count: { $sum: 1 }
        }}
    ]);

    return movements;
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

// Calculate total value and update status
inventorySchema.pre('save', function(next) {
    this.totalValue = this.quantity * this.unitPrice;
    this.updatedAt = new Date();

    if (this.quantity === 0) {
        this.status = 'out_of_stock';
    } else if (this.quantity <= this.minStock) {
        this.status = 'low_stock';
    } else {
        this.status = 'available';
    }

    next();
});

// ============================================
// MODEL CREATION
// ============================================
const Inventory = mongoose.model('Inventory', inventorySchema);

module.exports = Inventory;