const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const Maintenance = require('../models/Maintenance');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

// ============================================
// GET all rooms for current hotel
// ============================================
router.get('/', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { 
            status, 
            type, 
            floor,
            minPrice,
            maxPrice,
            search,
            limit = 100,
            page = 1
        } = req.query;

        let query = { hotelId, isDeleted: false };

        if (status) query.status = status;
        if (type) query.type = type;
        if (floor) query.floor = parseInt(floor);
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = parseFloat(minPrice);
            if (maxPrice) query.price.$lte = parseFloat(maxPrice);
        }
        if (search) {
            query.$or = [
                { roomNumber: { $regex: search, $options: 'i' } },
                { type: { $regex: search, $options: 'i' } },
                { guestName: { $regex: search, $options: 'i' } }
            ];
        }

        const rooms = await Room.find(query)
            .sort({ roomNumber: 1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Room.countDocuments(query);

        // Get additional stats for each room
        const roomsWithStats = await Promise.all(rooms.map(async (room) => {
            const [activeBooking, activeMaintenance] = await Promise.all([
                Booking.findOne({
                    hotelId,
                    roomNumber: room.roomNumber,
                    status: { $in: ['confirmed', 'checked_in'] },
                    checkInDate: { $lte: new Date() },
                    checkOutDate: { $gte: new Date() }
                }),
                Maintenance.findOne({
                    hotelId,
                    roomNumber: room.roomNumber,
                    status: { $in: ['pending', 'in_progress'] }
                })
            ]);

            return {
                ...room.toObject(),
                currentBooking: activeBooking ? {
                    guestName: activeBooking.guestName,
                    checkOut: activeBooking.checkOutDate
                } : null,
                hasMaintenance: !!activeMaintenance
            };
        }));

        res.json({
            success: true,
            count: roomsWithStats.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            data: roomsWithStats
        });
    } catch (error) {
        console.error('Get rooms error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET single room by ID or room number
// ============================================
router.get('/:identifier', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { identifier } = req.params;

        let room;
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
            room = await Room.findOne({ _id: identifier, hotelId, isDeleted: false });
        } else {
            room = await Room.findOne({ roomNumber: identifier, hotelId, isDeleted: false });
        }

        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Room not found'
            });
        }

        // Get room history
        const [bookings, maintenances] = await Promise.all([
            Booking.find({ hotelId, roomNumber: room.roomNumber })
                .sort({ createdAt: -1 })
                .limit(10),
            Maintenance.find({ hotelId, roomNumber: room.roomNumber })
                .sort({ createdAt: -1 })
                .limit(10)
        ]);

        res.json({
            success: true,
            data: {
                ...room.toObject(),
                history: {
                    bookings: bookings,
                    maintenances: maintenances,
                    totalBookings: bookings.length,
                    totalMaintenances: maintenances.length
                }
            }
        });
    } catch (error) {
        console.error('Get room error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CREATE new room
// ============================================
router.post('/', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            roomNumber,
            type,
            price,
            status,
            floor,
            capacity,
            amenities,
            images,
            description
        } = req.body;

        // Validation
        if (!roomNumber || !type) {
            return res.status(400).json({
                success: false,
                error: 'Room number and type are required'
            });
        }

        // Check if room already exists
        const existingRoom = await Room.findOne({ hotelId, roomNumber, isDeleted: false });
        if (existingRoom) {
            return res.status(400).json({
                success: false,
                error: 'Room number already exists'
            });
        }

        const room = new Room({
            hotelId,
            roomNumber,
            type: type || 'Standard',
            price: price || 0,
            status: status || 'Vacant',
            floor: floor || 1,
            capacity: capacity || 2,
            amenities: amenities || [],
            images: images || [],
            description: description || ''
        });

        await room.save();

        res.status(201).json({
            success: true,
            message: 'Room created successfully',
            data: room
        });
    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE room
// ============================================
router.put('/:id', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            roomNumber,
            type,
            price,
            status,
            floor,
            capacity,
            amenities,
            images,
            description,
            guestName
        } = req.body;

        const room = await Room.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Room not found'
            });
        }

        // Check if room number is being changed and already exists
        if (roomNumber && roomNumber !== room.roomNumber) {
            const existingRoom = await Room.findOne({ hotelId, roomNumber, isDeleted: false });
            if (existingRoom) {
                return res.status(400).json({
                    success: false,
                    error: 'Room number already exists'
                });
            }
        }

        // Update fields
        if (roomNumber) room.roomNumber = roomNumber;
        if (type) room.type = type;
        if (price !== undefined) room.price = price;
        if (status) room.status = status;
        if (floor !== undefined) room.floor = floor;
        if (capacity !== undefined) room.capacity = capacity;
        if (amenities) room.amenities = amenities;
        if (images) room.images = images;
        if (description !== undefined) room.description = description;
        if (guestName !== undefined) room.guestName = guestName;

        room.updatedAt = new Date();
        await room.save();

        res.json({
            success: true,
            message: 'Room updated successfully',
            data: room
        });
    } catch (error) {
        console.error('Update room error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE room (Soft delete)
// ============================================
router.delete('/:id', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const room = await Room.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Room not found'
            });
        }

        // Check if room has active bookings
        const activeBooking = await Booking.findOne({
            hotelId,
            roomNumber: room.roomNumber,
            status: { $in: ['confirmed', 'checked_in'] },
            checkOutDate: { $gte: new Date() }
        });

        if (activeBooking) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete room with active bookings'
            });
        }

        room.isDeleted = true;
        room.deletedAt = new Date();
        room.updatedAt = new Date();
        await room.save();

        res.json({
            success: true,
            message: 'Room deleted successfully'
        });
    } catch (error) {
        console.error('Delete room error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE room status
// ============================================
router.patch('/:id/status', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { status, guestName } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Status is required'
            });
        }

        const room = await Room.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Room not found'
            });
        }

        room.status = status;
        if (guestName !== undefined) room.guestName = guestName;
        if (status !== 'Occupied') room.guestName = '';

        room.updatedAt = new Date();
        await room.save();

        res.json({
            success: true,
            message: `Room status updated to ${status}`,
            data: room
        });
    } catch (error) {
        console.error('Update room status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET available rooms for date range
// ============================================
router.get('/available/check', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { checkIn, checkOut, guests = 1, type } = req.query;

        if (!checkIn || !checkOut) {
            return res.status(400).json({
                success: false,
                error: 'Check-in and check-out dates are required'
            });
        }

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        // Find rooms that are NOT booked during the requested period
        const overlappingBookings = await Booking.find({
            hotelId,
            status: { $in: ['confirmed', 'checked_in'] },
            $or: [
                { checkInDate: { $lt: checkOutDate, $gte: checkInDate } },
                { checkOutDate: { $gt: checkInDate, $lte: checkOutDate } },
                { checkInDate: { $lte: checkInDate }, checkOutDate: { $gte: checkOutDate } }
            ]
        }).select('roomNumber');

        const bookedRoomNumbers = overlappingBookings.map(b => b.roomNumber);

        let query = {
            hotelId,
            isDeleted: false,
            status: 'Vacant',
            roomNumber: { $nin: bookedRoomNumbers },
            capacity: { $gte: parseInt(guests) }
        };

        if (type) query.type = type;

        const availableRooms = await Room.find(query).sort({ roomNumber: 1 });

        // Group by type
        const byType = availableRooms.reduce((acc, room) => {
            if (!acc[room.type]) acc[room.type] = [];
            acc[room.type].push(room);
            return acc;
        }, {});

        res.json({
            success: true,
            count: availableRooms.length,
            byType,
            data: availableRooms
        });
    } catch (error) {
        console.error('Check available rooms error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET rooms by status
// ============================================
router.get('/status/:status', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { status } = req.params;

        const rooms = await Room.find({
            hotelId,
            status,
            isDeleted: false
        }).sort({ roomNumber: 1 });

        res.json({
            success: true,
            count: rooms.length,
            data: rooms
        });
    } catch (error) {
        console.error('Get rooms by status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET rooms by type
// ============================================
router.get('/type/:type', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { type } = req.params;

        const rooms = await Room.find({
            hotelId,
            type,
            isDeleted: false
        }).sort({ roomNumber: 1 });

        res.json({
            success: true,
            count: rooms.length,
            data: rooms
        });
    } catch (error) {
        console.error('Get rooms by type error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET room occupancy report
// ============================================
router.get('/reports/occupancy', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { startDate, endDate } = req.query;

        let start = new Date();
        let end = new Date();

        if (startDate) start = new Date(startDate);
        if (endDate) end = new Date(endDate);
        else end.setMonth(end.getMonth() + 1);

        // Get all rooms
        const allRooms = await Room.find({ hotelId, isDeleted: false });

        // Get bookings in date range
        const bookings = await Booking.find({
            hotelId,
            status: { $in: ['confirmed', 'checked_in'] },
            $or: [
                { checkInDate: { $lte: end, $gte: start } },
                { checkOutDate: { $lte: end, $gte: start } }
            ]
        });

        const occupiedRoomNumbers = new Set(bookings.map(b => b.roomNumber));
        const occupiedCount = allRooms.filter(r => occupiedRoomNumbers.has(r.roomNumber)).length;

        res.json({
            success: true,
            data: {
                totalRooms: allRooms.length,
                occupiedRooms: occupiedCount,
                vacantRooms: allRooms.length - occupiedCount,
                occupancyRate: allRooms.length > 0 ? ((occupiedCount / allRooms.length) * 100).toFixed(1) : 0,
                period: { start, end }
            }
        });
    } catch (error) {
        console.error('Get occupancy report error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET room statistics
// ============================================
router.get('/stats/summary', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const total = await Room.countDocuments({ hotelId, isDeleted: false });

        const byStatus = await Room.aggregate([
            { $match: { hotelId, isDeleted: false } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        const byType = await Room.aggregate([
            { $match: { hotelId, isDeleted: false } },
            { $group: { _id: '$type', count: { $sum: 1 }, avgPrice: { $avg: '$price' } } }
        ]);

        const totalRevenue = await Booking.aggregate([
            { $match: { hotelId, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);

        res.json({
            success: true,
            data: {
                total,
                byStatus,
                byType,
                totalRevenue: totalRevenue[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('Get room stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// BULK create rooms
// ============================================
router.post('/bulk/create', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { rooms } = req.body;

        if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Rooms array is required'
            });
        }

        const roomsWithHotelId = rooms.map(room => ({
            ...room,
            hotelId,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        const created = await Room.insertMany(roomsWithHotelId, { ordered: false });

        res.status(201).json({
            success: true,
            message: `${created.length} rooms created successfully`,
            count: created.length,
            data: created
        });
    } catch (error) {
        console.error('Bulk create rooms error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            partialSuccess: error.insertedDocs?.length || 0
        });
    }
});

module.exports = router;