require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../inaya-hotel/public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
    message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Configuration
const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'inaya_hotel';
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';

let db;
let client;

// Database Connection
async function connectDB() {
    try {
        console.log('🔄 Connecting to MongoDB Atlas...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        await db.command({ ping: 1 });
        console.log('✅ MongoDB Atlas Connected Successfully!');
        
        // Drop problematic index if exists
        try {
            const indexes = await db.collection('bookings').indexes();
            const hasBookingNumberIndex = indexes.some(idx => idx.name === 'bookingNumber_1');
            if (hasBookingNumberIndex) {
                await db.collection('bookings').dropIndex('bookingNumber_1');
                console.log('✅ Removed duplicate bookingNumber index');
            }
        } catch (err) {
            console.log('No index issue found');
        }
        
        return db;
    } catch (error) {
        console.error('❌ MongoDB Error:', error.message);
        return null;
    }
}

// Helper function to check if room is available
function isRoomAvailable(status) {
    return status === 'Vacant' || status === 'available' || status === 'vacant';
}

// Generate unique booking number
function generateBookingNumber() {
    return 'BOOK' + Date.now() + Math.random().toString(36).substr(2, 5);
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        message: `${process.env.HOTEL_NAME} API`,
        mongodb: db ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Get all rooms
app.get('/api/rooms', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const rooms = await db.collection('rooms').find({}).toArray();
        res.json({ success: true, data: rooms, count: rooms.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available rooms (Vacant status)
app.get('/api/rooms/available', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const rooms = await db.collection('rooms').find({ 
            $or: [
                { status: 'Vacant' },
                { status: 'available' },
                { status: 'vacant' }
            ]
        }).toArray();
        res.json({ success: true, data: rooms, count: rooms.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get room by number
app.get('/api/rooms/:number', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const room = await db.collection('rooms').findOne({ number: parseInt(req.params.number) });
        if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
        res.json({ success: true, data: room });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create booking (Fixed duplicate key issue)
app.post('/api/bookings', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const { roomNumber, customerName, checkIn, checkOut, guests, phone, email } = req.body;
        
        const room = await db.collection('rooms').findOne({ number: parseInt(roomNumber) });
        if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
        
        // Check if room is available (Vacant status)
        if (!isRoomAvailable(room.status)) {
            return res.status(400).json({ 
                success: false, 
                error: `Room not available. Current status: ${room.status}` 
            });
        }
        
        const booking = {
            bookingId: generateBookingNumber(),
            roomNumber: parseInt(roomNumber),
            roomType: room.type,
            customerName,
            phone,
            email,
            checkIn: new Date(checkIn),
            checkOut: new Date(checkOut),
            guests: parseInt(guests),
            totalPrice: room.price * parseInt(guests),
            bookingDate: new Date(),
            status: 'confirmed'
        };
        
        const result = await db.collection('bookings').insertOne(booking);
        
        // Update room status to 'Occupied'
        await db.collection('rooms').updateOne(
            { number: parseInt(roomNumber) },
            { $set: { status: 'Occupied', guestName: customerName, checkIn: new Date(checkIn), checkOut: new Date(checkOut) } }
        );
        
        res.json({ success: true, message: 'Booking confirmed!', bookingId: booking.bookingId, booking });
    } catch (error) {
        console.error('Booking error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all bookings
app.get('/api/bookings', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const bookings = await db.collection('bookings').find({}).sort({ bookingDate: -1 }).toArray();
        res.json({ success: true, data: bookings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cancel booking
app.delete('/api/bookings/:bookingId', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const bookingId = req.params.bookingId;
        const booking = await db.collection('bookings').findOne({ bookingId });
        
        if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
        
        // Delete booking
        await db.collection('bookings').deleteOne({ bookingId });
        
        // Make room vacant again
        await db.collection('rooms').updateOne(
            { number: booking.roomNumber },
            { $set: { status: 'Vacant', guestName: '', checkIn: null, checkOut: null } }
        );
        
        res.json({ success: true, message: 'Booking cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check-out / Make room vacant again
app.post('/api/checkout/:roomNumber', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const roomNumber = parseInt(req.params.roomNumber);
        
        // Update room status to 'Vacant' and clear guest info
        await db.collection('rooms').updateOne(
            { number: roomNumber },
            { 
                $set: { 
                    status: 'Vacant', 
                    guestName: '',
                    checkIn: null,
                    checkOut: null 
                } 
            }
        );
        
        res.json({ success: true, message: `Room ${roomNumber} is now available` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const { email, password } = req.body;
        const user = await db.collection('users').findOne({ email });
        if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ success: false, error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, message: 'Login successful', token, user: { email: user.email, name: user.name, role: user.role } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
    if (!db) return res.status(503).json({ success: false, error: 'Database not connected' });
    try {
        const totalRooms = await db.collection('rooms').countDocuments();
        const vacantRooms = await db.collection('rooms').countDocuments({ status: 'Vacant' });
        const occupiedRooms = await db.collection('rooms').countDocuments({ status: 'Occupied' });
        const cleaningRooms = await db.collection('rooms').countDocuments({ status: 'Cleaning' });
        const totalBookings = await db.collection('bookings').countDocuments();
        
        // Calculate total revenue
        const bookings = await db.collection('bookings').find({}).toArray();
        const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);
        
        res.json({
            success: true,
            data: {
                totalRooms,
                vacantRooms,
                occupiedRooms,
                cleaningRooms,
                totalBookings,
                totalRevenue,
                occupancyRate: ((occupiedRooms / totalRooms) * 100).toFixed(2)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Frontend routes
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../inaya-hotel/public/admin.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../inaya-hotel/public/index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 ${process.env.HOTEL_NAME || 'Inaya Hotel'} Server Started!`);
    console.log('='.repeat(50));
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin`);
    console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
    console.log(`🏠 Rooms: http://localhost:${PORT}/api/rooms`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/dashboard/stats`);
    console.log('='.repeat(50) + '\n');
    
    await connectDB();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    if (client) await client.close();
    console.log('\n👋 Server stopped');
    process.exit(0);
});

module.exports = app;
