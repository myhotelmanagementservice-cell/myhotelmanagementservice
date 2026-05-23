const mongoose = require('mongoose');

// ============================================
// MAINTENANCE SCHEMA - Hotel Maintenance Management
// ============================================

const maintenanceSchema = new mongoose.Schema({
    // Multi-tenant support
    hotelId: {
        type: String,
        required: [true, 'Hotel ID is required'],
        index: true
    },

    // Task Information
    taskId: {
        type: String,
        unique: true,
        default: function() {
            return 'MT' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        }
    },
    title: {
        type: String,
        required: [true, 'Task title is required'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Task description is required']
    },

    // Location
    roomNumber: {
        type: String,
        index: true
    },
    area: {
        type: String,
        enum: ['room', 'lobby', 'restaurant', 'kitchen', 'bathroom', 'pool', 'gym', 'spa', 'parking', 'corridor', 'elevator', 'roof', 'basement', 'other'],
        default: 'room'
    },
    floor: {
        type: Number,
        default: 1
    },
    locationDetails: {
        type: String,
        default: ''
    },

    // Category & Type
    category: {
        type: String,
        required: true,
        enum: ['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'paint', 'cleaning', 'structural', 'safety', 'landscaping', 'other'],
        index: true
    },
    priority: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high', 'urgent', 'emergency'],
        default: 'medium',
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'assigned', 'in_progress', 'waiting_parts', 'completed', 'cancelled', 'deferred'],
        default: 'pending',
        index: true
    },

    // Assignment
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff'
    },
    assignedToName: {
        type: String,
        default: ''
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    assignedAt: {
        type: Date,
        default: null
    },
    department: {
        type: String,
        enum: ['housekeeping', 'maintenance', 'electrical', 'plumbing', 'hvac', 'carpentry', 'painting', 'other'],
        default: 'maintenance'
    },

    // Dates
    reportedAt: {
        type: Date,
        default: Date.now
    },
    reportedBy: {
        type: String,
        default: ''
    },
    reportedByGuest: {
        type: String,
        default: ''
    },
    scheduledDate: {
        type: Date,
        default: null
    },
    startedAt: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    deadline: {
        type: Date,
        default: null
    },

    // Duration Tracking
    estimatedDuration: {
        hours: { type: Number, default: 0 },
        minutes: { type: Number, default: 0 }
    },
    actualDuration: {
        hours: { type: Number, default: 0 },
        minutes: { type: Number, default: 0 }
    },

    // Parts & Materials
    partsUsed: [{
        partName: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        unit: { type: String, default: 'pcs' },
        cost: { type: Number, default: 0 },
        supplier: { type: String, default: '' }
    }],
    totalPartsCost: {
        type: Number,
        default: 0
    },
    laborCost: {
        type: Number,
        default: 0
    },
    totalCost: {
        type: Number,
        default: 0
    },

    // Guest Information (if reported by guest)
    guestName: {
        type: String,
        default: ''
    },
    guestRoom: {
        type: String,
        default: ''
    },
    requestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Request'
    },

    // Images & Attachments
    images: [{
        url: String,
        caption: String,
        uploadedAt: { type: Date, default: Date.now }
    }],

    // Notes & Updates
    notes: [{
        note: { type: String, required: true },
        createdBy: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
        isInternal: { type: Boolean, default: false }
    }],

    // Maintenance Type
    maintenanceType: {
        type: String,
        enum: ['preventive', 'corrective', 'emergency', 'predictive', 'routine'],
        default: 'corrective'
    },

    // Recurring Task
    isRecurring: {
        type: Boolean,
        default: false
    },
    recurrencePattern: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
        default: null
    },
    recurrenceEndDate: {
        type: Date,
        default: null
    },
    parentTaskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Maintenance'
    },

    // Safety & Compliance
    safetyRequired: {
        type: Boolean,
        default: false
    },
    safetyChecklist: [{
        item: String,
        completed: { type: Boolean, default: false },
        completedBy: { type: String, default: '' },
        completedAt: { type: Date, default: null }
    }],
    permitRequired: {
        type: Boolean,
        default: false
    },
    permitNumber: {
        type: String,
        default: ''
    },

    // Quality Check
    qualityCheck: {
        performedBy: { type: String, default: '' },
        performedAt: { type: Date, default: null },
        rating: { type: Number, min: 1, max: 5, default: null },
        comments: { type: String, default: '' },
        approved: { type: Boolean, default: false }
    },

    // Feedback
    guestFeedback: {
        rating: { type: Number, min: 1, max: 5, default: null },
        comment: { type: String, default: '' },
        submittedAt: { type: Date, default: null }
    },

    // Status History
    statusHistory: [{
        status: { type: String, required: true },
        changedBy: { type: String, default: '' },
        changedAt: { type: Date, default: Date.now },
        note: { type: String, default: '' }
    }],

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
maintenanceSchema.index({ hotelId: 1, status: 1, priority: -1 });
maintenanceSchema.index({ hotelId: 1, roomNumber: 1 });
maintenanceSchema.index({ hotelId: 1, assignedTo: 1 });
maintenanceSchema.index({ hotelId: 1, category: 1 });
maintenanceSchema.index({ scheduledDate: 1 });
maintenanceSchema.index({ deadline: 1 });

// ============================================
// VIRTUAL FIELDS
// ============================================

// Check if task is overdue
maintenanceSchema.virtual('isOverdue').get(function() {
    if (this.status === 'completed' || this.status === 'cancelled') return false;
    if (!this.deadline) return false;
    return this.deadline < new Date();
});

// Get priority color
maintenanceSchema.virtual('priorityColor').get(function() {
    const colors = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        urgent: '🔴',
        emergency: '🔥'
    };
    return colors[this.priority] || '⚪';
});

// Get status color
maintenanceSchema.virtual('statusColor').get(function() {
    const colors = {
        pending: '🟡',
        assigned: '🔵',
        in_progress: '🟣',
        waiting_parts: '🟠',
        completed: '🟢',
        cancelled: '⚫',
        deferred: '⚪'
    };
    return colors[this.status] || '⚪';
});

// Time since reported
maintenanceSchema.virtual('timeSinceReported').get(function() {
    const diff = new Date() - this.reportedAt;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day(s)`;
    if (hours > 0) return `${hours} hour(s)`;
    return `${Math.floor(diff / (1000 * 60))} minute(s)`;
});

// ============================================
// INSTANCE METHODS
// ============================================

// Assign task to staff
maintenanceSchema.methods.assignTo = async function(staffId, staffName, assignedBy) {
    this.assignedTo = staffId;
    this.assignedToName = staffName;
    this.assignedBy = assignedBy;
    this.assignedAt = new Date();
    this.status = 'assigned';

    this.statusHistory.push({
        status: 'assigned',
        changedBy: assignedBy,
        note: `Assigned to ${staffName}`
    });

    this.updatedAt = new Date();
    return await this.save();
};

// Start task
maintenanceSchema.methods.startTask = async function(startedBy) {
    if (this.status !== 'assigned' && this.status !== 'pending') {
        throw new Error(`Cannot start task from status: ${this.status}`);
    }

    this.status = 'in_progress';
    this.startedAt = new Date();

    this.statusHistory.push({
        status: 'in_progress',
        changedBy: startedBy,
        note: 'Task started'
    });

    this.updatedAt = new Date();
    return await this.save();
};

// Complete task
maintenanceSchema.methods.completeTask = async function(completedBy) {
    if (this.status !== 'in_progress') {
        throw new Error(`Cannot complete task from status: ${this.status}`);
    }

    this.status = 'completed';
    this.completedAt = new Date();

    // Calculate actual duration
    if (this.startedAt) {
        const durationMs = this.completedAt - this.startedAt;
        this.actualDuration.hours = Math.floor(durationMs / (1000 * 60 * 60));
        this.actualDuration.minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    }

    this.statusHistory.push({
        status: 'completed',
        changedBy: completedBy,
        note: 'Task completed'
    });

    this.updatedAt = new Date();
    return await this.save();
};

// Cancel task
maintenanceSchema.methods.cancelTask = async function(cancelledBy, reason) {
    this.status = 'cancelled';

    this.statusHistory.push({
        status: 'cancelled',
        changedBy: cancelledBy,
        note: reason || 'Task cancelled'
    });

    this.updatedAt = new Date();
    return await this.save();
};

// Add part used
maintenanceSchema.methods.addPart = async function(partName, quantity, unit, cost, supplier = '') {
    this.partsUsed.push({
        partName,
        quantity,
        unit,
        cost,
        supplier
    });

    this.totalPartsCost = this.partsUsed.reduce((sum, p) => sum + (p.cost * p.quantity), 0);
    this.totalCost = this.totalPartsCost + this.laborCost;
    this.updatedAt = new Date();
    return await this.save();
};

// Add note
maintenanceSchema.methods.addNote = async function(note, createdBy, isInternal = false) {
    this.notes.push({
        note,
        createdBy,
        isInternal
    });
    this.updatedAt = new Date();
    return await this.save();
};

// Add image
maintenanceSchema.methods.addImage = async function(url, caption = '') {
    this.images.push({
        url,
        caption,
        uploadedAt: new Date()
    });
    this.updatedAt = new Date();
    return await this.save();
};

// Request parts
maintenanceSchema.methods.requestParts = async function(partsList, requestedBy) {
    this.status = 'waiting_parts';

    this.statusHistory.push({
        status: 'waiting_parts',
        changedBy: requestedBy,
        note: `Parts requested: ${partsList.map(p => p.name).join(', ')}`
    });

    this.updatedAt = new Date();
    return await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

// Get pending tasks by priority
maintenanceSchema.statics.getPendingTasks = function(hotelId, limit = 20) {
    return this.find({
        hotelId,
        status: { $in: ['pending', 'assigned', 'in_progress'] },
        isDeleted: false
    }).sort({ priority: -1, createdAt: 1 }).limit(limit);
};

// Get overdue tasks
maintenanceSchema.statics.getOverdueTasks = function(hotelId) {
    const now = new Date();
    return this.find({
        hotelId,
        status: { $in: ['pending', 'assigned', 'in_progress', 'waiting_parts'] },
        deadline: { $lt: now },
        isDeleted: false
    }).sort({ deadline: 1 });
};

// Get tasks by room
maintenanceSchema.statics.getByRoom = function(hotelId, roomNumber) {
    return this.find({
        hotelId,
        roomNumber,
        isDeleted: false
    }).sort({ createdAt: -1 });
};

// Get maintenance statistics
maintenanceSchema.statics.getStats = async function(hotelId) {
    const stats = await this.aggregate([
        { $match: { hotelId, isDeleted: false } },
        { $group: {
            _id: '$status',
            count: { $sum: 1 }
        }}
    ]);

    const priorityStats = await this.aggregate([
        { $match: { hotelId, isDeleted: false } },
        { $group: {
            _id: '$priority',
            count: { $sum: 1 }
        }}
    ]);

    const totalCost = await this.aggregate([
        { $match: { hotelId, isDeleted: false } },
        { $group: {
            _id: null,
            totalCost: { $sum: '$totalCost' },
            totalPartsCost: { $sum: '$totalPartsCost' },
            totalLaborCost: { $sum: '$laborCost' }
        }}
    ]);

    return {
        byStatus: stats,
        byPriority: priorityStats,
        costs: totalCost[0] || { totalCost: 0, totalPartsCost: 0, totalLaborCost: 0 },
        totalTasks: await this.countDocuments({ hotelId, isDeleted: false })
    };
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================

// Calculate total cost and update timestamps
maintenanceSchema.pre('save', function(next) {
    this.totalPartsCost = this.partsUsed.reduce((sum, p) => sum + (p.cost * p.quantity), 0);
    this.totalCost = this.totalPartsCost + this.laborCost;
    this.updatedAt = new Date();
    next();
});

// Auto-assign taskId if not present
maintenanceSchema.pre('save', function(next) {
    if (!this.taskId) {
        const prefix = 'MT';
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const random = Math.random().toString(36).substr(2, 5).toUpperCase();
        this.taskId = `${prefix}${year}${month}${day}${random}`;
    }
    next();
});

// ============================================
// MODEL CREATION
// ============================================
const Maintenance = mongoose.model('Maintenance', maintenanceSchema);

module.exports = Maintenance;