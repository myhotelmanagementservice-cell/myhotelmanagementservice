const express = require('express');
const router = express.Router();
const Guest = require('../models/Guest');
const Booking = require('../models/Booking');
const Request = require('../models/Request');
const Loyalty = require('../models/Loyalty');
const Blacklist = require('../models/Blacklist');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

// ============================================
// GET all guests for current hotel
// ============================================
router.get('/', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { 
            page = 1, 
            limit = 20, 
            search, 
            status, 
            roomNumber,
            isVIP,
            sortBy = 'createdAt',
            sortOrder = -1
        } = req.query;

        let query = { hotelId, isDeleted: false };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        if (status) query.status = status;
        if (roomNumber) query.roomNumber = roomNumber;
        if (isVIP !== undefined) query.isVIP = isVIP === 'true';

        const sortOptions = {};
        sortOptions[sortBy] = parseInt(sortOrder);

        const guests = await Guest.find(query)
            .sort(sortOptions)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Guest.countDocuments(query);

        res.json({
            success: true,
            count: guests.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            data: guests
        });
    } catch (error) {
        console.error('Get guests error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET single guest by ID
// ============================================
router.get('/:id', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        // Get additional stats
        const [bookings, requests, loyalty, blacklist] = await Promise.all([
            Booking.find({ guestId: guest._id, hotelId }).sort({ createdAt: -1 }).limit(10),
            Request.find({ guestId: guest._id, hotelId }).sort({ createdAt: -1 }).limit(10),
            Loyalty.findOne({ guestId: guest._id, hotelId }),
            Blacklist.findOne({ guestId: guest._id, hotelId, status: 'active' })
        ]);

        res.json({
            success: true,
            data: {
                ...guest.toObject(),
                stats: {
                    totalBookings: bookings.length,
                    totalRequests: requests.length,
                    loyaltyPoints: loyalty?.points || 0,
                    loyaltyTier: loyalty?.tier || 'bronze',
                    isBlacklisted: !!blacklist,
                    blacklistReason: blacklist?.reason || null
                },
                recentBookings: bookings,
                recentRequests: requests
            }
        });
    } catch (error) {
        console.error('Get guest error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CREATE new guest
// ============================================
router.post('/', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            name,
            email,
            phone,
            roomNumber,
            checkIn,
            checkOut,
            nationality,
            idProof,
            preferences
        } = req.body;

        // Validation
        if (!name || !email || !phone || !roomNumber) {
            return res.status(400).json({
                success: false,
                error: 'Name, email, phone, and room number are required'
            });
        }

        // Check if guest already exists with same email
        const existingGuest = await Guest.findOne({
            hotelId,
            email,
            isDeleted: false
        });

        if (existingGuest) {
            return res.status(400).json({
                success: false,
                error: 'Guest with this email already exists'
            });
        }

        const guest = new Guest({
            hotelId,
            name,
            email,
            phone,
            roomNumber,
            checkIn: checkIn || new Date(),
            checkOut,
            nationality: nationality || '',
            idProof: idProof || '',
            preferences: preferences || {}
        });

        await guest.save();

        // Create loyalty record
        const loyalty = new Loyalty({
            hotelId,
            guestId: guest._id,
            guestName: name,
            guestEmail: email,
            guestPhone: phone
        });
        await loyalty.save();

        res.status(201).json({
            success: true,
            message: 'Guest created successfully',
            data: guest
        });
    } catch (error) {
        console.error('Create guest error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE guest
// ============================================
router.put('/:id', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            name,
            email,
            phone,
            roomNumber,
            checkIn,
            checkOut,
            nationality,
            idProof,
            preferences,
            isVIP,
            status
        } = req.body;

        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        // Update fields
        if (name) guest.name = name;
        if (email) guest.email = email;
        if (phone) guest.phone = phone;
        if (roomNumber) guest.roomNumber = roomNumber;
        if (checkIn) guest.checkIn = checkIn;
        if (checkOut) guest.checkOut = checkOut;
        if (nationality !== undefined) guest.nationality = nationality;
        if (idProof !== undefined) guest.idProof = idProof;
        if (preferences) guest.preferences = { ...guest.preferences, ...preferences };
        if (isVIP !== undefined) guest.isVIP = isVIP;
        if (status) guest.status = status;

        guest.updatedAt = new Date();
        await guest.save();

        // Update loyalty record
        await Loyalty.findOneAndUpdate(
            { guestId: guest._id, hotelId },
            { guestName: name, guestEmail: email, guestPhone: phone },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Guest updated successfully',
            data: guest
        });
    } catch (error) {
        console.error('Update guest error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE guest (Soft delete)
// ============================================
router.delete('/:id', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        guest.isDeleted = true;
        guest.deletedAt = new Date();
        guest.updatedAt = new Date();
        await guest.save();

        res.json({
            success: true,
            message: 'Guest deleted successfully'
        });
    } catch (error) {
        console.error('Delete guest error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET guest history (bookings + requests)
// ============================================
router.get('/:id/history', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        const [bookings, requests] = await Promise.all([
            Booking.find({ guestId: guest._id, hotelId })
                .sort({ createdAt: -1 })
                .populate('roomId', 'roomNumber type'),
            Request.find({ guestId: guest._id, hotelId })
                .sort({ createdAt: -1 })
        ]);

        res.json({
            success: true,
            data: {
                guest: {
                    name: guest.name,
                    email: guest.email,
                    phone: guest.phone,
                    roomNumber: guest.roomNumber,
                    checkIn: guest.checkIn,
                    checkOut: guest.checkOut,
                    isVIP: guest.isVIP
                },
                totalBookings: bookings.length,
                totalRequests: requests.length,
                bookings,
                requests
            }
        });
    } catch (error) {
        console.error('Get guest history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CHECK IN guest
// ============================================
router.put('/:id/checkin', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        guest.status = 'checked_in';
        guest.checkIn = new Date();
        guest.updatedAt = new Date();
        await guest.save();

        res.json({
            success: true,
            message: 'Guest checked in successfully',
            data: guest
        });
    } catch (error) {
        console.error('Checkin error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CHECK OUT guest
// ============================================
router.put('/:id/checkout', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        guest.status = 'checked_out';
        guest.checkOut = new Date();
        guest.updatedAt = new Date();
        await guest.save();

        res.json({
            success: true,
            message: 'Guest checked out successfully',
            data: guest
        });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// ADD loyalty points to guest
// ============================================
router.post('/:id/loyalty/add', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { points, reason } = req.body;

        if (!points || points <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid points are required'
            });
        }

        const guest = await Guest.findOne({
            _id: req.params.id,
            hotelId,
            isDeleted: false
        });

        if (!guest) {
            return res.status(404).json({
                success: false,
                error: 'Guest not found'
            });
        }

        let loyalty = await Loyalty.findOne({ guestId: guest._id, hotelId });
        if (!loyalty) {
            loyalty = new Loyalty({
                hotelId,
                guestId: guest._id,
                guestName: guest.name,
                guestEmail: guest.email
            });
        }

        await loyalty.addPoints(points, reason || 'Admin added points', null, 'admin', req.user?.name || 'Admin');

        // Update guest total points
        guest.loyaltyPoints = loyalty.points;
        await guest.save();

        res.json({
            success: true,
            message: `${points} loyalty points added successfully`,
            data: { points: loyalty.points, totalEarned: loyalty.totalPointsEarned }
        });
    } catch (error) {
        console.error('Add loyalty points error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET guests by room
// ============================================
router.get('/room/:roomNumber', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { roomNumber } = req.params;

        const guests = await Guest.find({
            hotelId,
            roomNumber,
            isDeleted: false
        }).sort({ checkIn: -1 });

        res.json({
            success: true,
            count: guests.length,
            data: guests
        });
    } catch (error) {
        console.error('Get guests by room error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET current checked-in guests
// ============================================
router.get('/status/checked-in', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const guests = await Guest.find({
            hotelId,
            status: 'checked_in',
            isDeleted: false
        }).sort({ checkIn: -1 });

        res.json({
            success: true,
            count: guests.length,
            data: guests
        });
    } catch (error) {
        console.error('Get checked-in guests error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET VIP guests
// ============================================
router.get('/vip/all', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const guests = await Guest.find({
            hotelId,
            isVIP: true,
            isDeleted: false
        }).sort({ loyaltyPoints: -1 });

        res.json({
            success: true,
            count: guests.length,
            data: guests
        });
    } catch (error) {
        console.error('Get VIP guests error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET guest statistics
// ============================================
router.get('/stats/summary', protect, authorize('super_admin', 'hotel_admin'), async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;

        const total = await Guest.countDocuments({ hotelId, isDeleted: false });
        const checkedIn = await Guest.countDocuments({ hotelId, status: 'checked_in', isDeleted: false });
        const checkedOut = await Guest.countDocuments({ hotelId, status: 'checked_out', isDeleted: false });
        const vip = await Guest.countDocuments({ hotelId, isVIP: true, isDeleted: false });

        const byRoomType = await Guest.aggregate([
            { $match: { hotelId, isDeleted: false } },
            { $group: {
                _id: '$roomType',
                count: { $sum: 1 }
            }}
        ]);

        res.json({
            success: true,
            data: {
                total,
                checkedIn,
                checkedOut,
                vip,
                byRoomType,
                occupancyRate: total > 0 ? ((checkedIn / total) * 100).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error('Get guest stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// SEARCH guests
// ============================================
router.get('/search/query', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                error: 'Search query is required'
            });
        }

        const guests = await Guest.find({
            hotelId,
            isDeleted: false,
            $or: [
                { name: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
                { phone: { $regex: q, $options: 'i' } },
                { roomNumber: { $regex: q, $options: 'i' } }
            ]
        }).limit(20);

        res.json({
            success: true,
            count: guests.length,
            data: guests
        });
    } catch (error) {
        console.error('Search guests error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;