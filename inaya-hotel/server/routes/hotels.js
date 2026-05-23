const express = require('express');
const router = express.Router();
const Hotel = require('../models/Hotel');
const User = require('../models/User');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { protect, authorize, checkHotelAccess } = require('../middleware/auth');

// ============================================
// GET all hotels (Super Admin only)
// ============================================
router.get('/', protect, authorize('super_admin'), async (req, res) => {
    try {
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

        const hotels = await Hotel.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));

        // Get stats for each hotel
        const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
            const userCount = await User.countDocuments({ hotelId: hotel.hotelId });
            const roomCount = await Room.countDocuments({ hotelId: hotel.hotelId });
            const bookingCount = await Booking.countDocuments({ hotelId: hotel.hotelId });

            return {
                ...hotel.toObject(),
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET single hotel by ID
// ============================================
router.get('/:hotelId', protect, async (req, res) => {
    try {
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

        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        // Get detailed stats
        const [userCount, roomCount, bookingCount, activeBookings] = await Promise.all([
            User.countDocuments({ hotelId, isActive: true }),
            Room.countDocuments({ hotelId }),
            Booking.countDocuments({ hotelId }),
            Booking.countDocuments({ 
                hotelId, 
                status: { $in: ['confirmed', 'checked_in'] },
                checkInDate: { $lte: new Date() },
                checkOutDate: { $gte: new Date() }
            })
        ]);

        res.json({
            success: true,
            data: {
                ...hotel.toObject(),
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// CREATE new hotel (Super Admin only)
// ============================================
router.post('/', protect, authorize('super_admin'), async (req, res) => {
    try {
        const {
            hotelId,
            name,
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
        if (!hotelId || !name || !country || !countryCode) {
            return res.status(400).json({
                success: false,
                error: 'Hotel ID, name, country, and country code are required'
            });
        }

        // Check if hotel already exists
        const existingHotel = await Hotel.findOne({ $or: [{ hotelId }, { email }] });
        if (existingHotel) {
            return res.status(400).json({
                success: false,
                error: 'Hotel with this ID or email already exists'
            });
        }

        const hotel = new Hotel({
            hotelId: hotelId.toUpperCase(),
            name,
            country,
            countryCode: countryCode.toUpperCase(),
            currency: currency || 'USD',
            currencySymbol: currencySymbol || '$',
            timezone: timezone || 'Asia/Kolkata',
            language: language || 'en',
            wifiPassword: wifiPassword || `${name}@2024`,
            phone: phone || '',
            email,
            address: address || '',
            logo: logo || '',
            theme: theme || {
                primaryColor: '#8B5CF6',
                secondaryColor: '#F59E0B'
            },
            subscriptionType: subscriptionType || 'free',
            isActive: true
        });

        await hotel.save();

        // Create default admin user for this hotel
        const defaultAdmin = new User({
            hotelId: hotel.hotelId,
            email: `admin@${hotelId.toLowerCase()}.com`,
            password: 'Admin@123',
            name: `${name} Administrator`,
            role: 'hotel_admin',
            isActive: true
        });
        await defaultAdmin.save();

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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE hotel (Super Admin or Hotel Admin)
// ============================================
router.put('/:hotelId', protect, async (req, res) => {
    try {
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

        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        const {
            name,
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

        // Update fields
        if (name) hotel.name = name;
        if (country) hotel.country = country;
        if (countryCode) hotel.countryCode = countryCode.toUpperCase();
        if (currency) hotel.currency = currency;
        if (currencySymbol) hotel.currencySymbol = currencySymbol;
        if (timezone) hotel.timezone = timezone;
        if (language) hotel.language = language;
        if (wifiPassword) hotel.wifiPassword = wifiPassword;
        if (phone !== undefined) hotel.phone = phone;
        if (email) hotel.email = email;
        if (address !== undefined) hotel.address = address;
        if (logo !== undefined) hotel.logo = logo;
        if (theme) hotel.theme = { ...hotel.theme, ...theme };
        if (subscriptionType && userRole === 'super_admin') hotel.subscriptionType = subscriptionType;
        if (isActive !== undefined && userRole === 'super_admin') hotel.isActive = isActive;

        hotel.updatedAt = new Date();
        await hotel.save();

        res.json({
            success: true,
            message: 'Hotel updated successfully',
            data: hotel
        });
    } catch (error) {
        console.error('Update hotel error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// DELETE hotel (Soft delete - Super Admin only)
// ============================================
router.delete('/:hotelId', protect, authorize('super_admin'), async (req, res) => {
    try {
        const { hotelId } = req.params;
        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        // Soft delete
        hotel.isActive = false;
        hotel.deletedAt = new Date();
        hotel.updatedAt = new Date();
        await hotel.save();

        // Also deactivate all users of this hotel
        await User.updateMany(
            { hotelId },
            { isActive: false, updatedAt: new Date() }
        );

        res.json({
            success: true,
            message: 'Hotel deactivated successfully'
        });
    } catch (error) {
        console.error('Delete hotel error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET hotel settings (for current hotel)
// ============================================
router.get('/settings/current', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        res.json({
            success: true,
            data: {
                name: hotel.name,
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// UPDATE hotel settings
// ============================================
router.put('/settings/current', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const {
            name,
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

        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        if (name) hotel.name = name;
        if (currency) hotel.currency = currency;
        if (currencySymbol) hotel.currencySymbol = currencySymbol;
        if (timezone) hotel.timezone = timezone;
        if (language) hotel.language = language;
        if (wifiPassword) hotel.wifiPassword = wifiPassword;
        if (phone !== undefined) hotel.phone = phone;
        if (email) hotel.email = email;
        if (address !== undefined) hotel.address = address;
        if (logo !== undefined) hotel.logo = logo;
        if (theme) hotel.theme = { ...hotel.theme, ...theme };

        hotel.updatedAt = new Date();
        await hotel.save();

        res.json({
            success: true,
            message: 'Hotel settings updated successfully',
            data: hotel
        });
    } catch (error) {
        console.error('Update hotel settings error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET hotel dashboard stats
// ============================================
router.get('/dashboard/stats', protect, async (req, res) => {
    try {
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

        const [totalRooms, occupiedRooms, totalBookings, activeBookings, totalRevenue] = await Promise.all([
            Room.countDocuments({ hotelId }),
            Room.countDocuments({ hotelId, status: 'Occupied' }),
            Booking.countDocuments({ hotelId }),
            Booking.countDocuments({ 
                hotelId, 
                status: { $in: ['confirmed', 'checked_in'] },
                checkInDate: { $lte: new Date() },
                checkOutDate: { $gte: new Date() }
            }),
            Booking.aggregate([
                { $match: { hotelId, createdAt: { $gte: startDate, $lte: endDate } } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ])
        ]);

        // Monthly booking trend
        const monthlyTrend = await Booking.aggregate([
            { $match: { hotelId, createdAt: { $gte: startDate, $lte: endDate } } },
            { $group: {
                _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
                count: { $sum: 1 },
                revenue: { $sum: '$totalPrice' }
            }},
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

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
                    revenue: totalRevenue[0]?.total || 0
                },
                trend: monthlyTrend
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET hotels by country
// ============================================
router.get('/country/:countryCode', protect, authorize('super_admin'), async (req, res) => {
    try {
        const { countryCode } = req.params;

        const hotels = await Hotel.find({ 
            countryCode: countryCode.toUpperCase(),
            isActive: true 
        }).sort({ name: 1 });

        res.json({
            success: true,
            count: hotels.length,
            data: hotels
        });
    } catch (error) {
        console.error('Get hotels by country error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// GET hotel subscription info
// ============================================
router.get('/subscription/info', protect, async (req, res) => {
    try {
        const hotelId = req.hotelId || req.user?.hotelId;
        const hotel = await Hotel.findOne({ hotelId }).select('subscriptionType subscriptionExpiry');

        if (!hotel) {
            return res.status(404).json({
                success: false,
                error: 'Hotel not found'
            });
        }

        const isExpired = hotel.subscriptionExpiry && hotel.subscriptionExpiry < new Date();

        res.json({
            success: true,
            data: {
                subscriptionType: hotel.subscriptionType,
                subscriptionExpiry: hotel.subscriptionExpiry,
                isExpired,
                daysRemaining: hotel.subscriptionExpiry ? 
                    Math.ceil((hotel.subscriptionExpiry - new Date()) / (1000 * 60 * 60 * 24)) : null
            }
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;