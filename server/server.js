require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../inaya-hotel/public')));

// Session configuration
app.use(session({
    secret: 'inaya-hotel-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'inaya_hotel';

let db;
let client;

async function connectDB() {
    try {
        console.log('🔄 Connecting to MongoDB Atlas...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        await db.command({ ping: 1 });
        console.log('✅ MongoDB Connected Successfully!');
        return db;
    } catch (error) {
        console.error('❌ MongoDB Error:', error.message);
        return null;
    }
}

// ==================== APIs ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        message: 'Inaya Hotel Management System API', 
        status: 'OK',
        mongodb: db ? 'connected' : 'disconnected'
    });
});

app.get('/api/rooms', async (req, res) => {
    if (!db) return res.json({ success: true, data: [] });
    try {
        const rooms = await db.collection('rooms').find({}).toArray();
        res.json({ success: true, data: rooms });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/rooms/available', async (req, res) => {
    if (!db) return res.json({ success: true, data: [] });
    try {
        const rooms = await db.collection('rooms').find({ status: 'Vacant' }).toArray();
        res.json({ success: true, data: rooms });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/bookings', async (req, res) => {
    if (!db) return res.json({ success: true, data: [] });
    try {
        const bookings = await db.collection('bookings').find({}).toArray();
        res.json({ success: true, data: bookings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/bookings', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database not connected' });
    try {
        const { roomNumber, customerName, checkIn, checkOut, guests, phone, email } = req.body;
        const room = await db.collection('rooms').findOne({ number: parseInt(roomNumber) });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        if (room.status !== 'Vacant') return res.status(400).json({ error: 'Room not available' });
        
        const booking = {
            bookingId: 'BOOK' + Date.now(),
            roomNumber: parseInt(roomNumber),
            roomType: room.type,
            customerName, phone, email,
            checkIn: new Date(checkIn),
            checkOut: new Date(checkOut),
            guests: parseInt(guests),
            totalPrice: room.price * parseInt(guests),
            bookingDate: new Date(),
            status: 'confirmed'
        };
        
        await db.collection('bookings').insertOne(booking);
        await db.collection('rooms').updateOne(
            { number: parseInt(roomNumber) },
            { $set: { status: 'Occupied', guestName: customerName } }
        );
        
        res.json({ success: true, message: 'Booking confirmed!', bookingId: booking.bookingId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin login with session
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 Admin login attempt:', email);
        
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database connecting...' });
        }
        
        const user = await db.collection('users').findOne({ email: email });
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        // Check password
        if (user.password !== password) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        // Save session
        req.session.isAdmin = true;
        req.session.adminEmail = email;
        
        const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
        console.log('✅ Admin login successful:', email);
        
        res.json({
            success: true,
            token: token,
            user: { email: user.email, name: user.name || 'Admin', role: 'admin' },
            hotelId: 'CPH001'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check session (for page refresh)
app.get('/api/admin/check-session', (req, res) => {
    if (req.session.isAdmin) {
        res.json({ success: true, isAdmin: true, email: req.session.adminEmail });
    } else {
        res.json({ success: false, isAdmin: false });
    }
});

// Logout
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out' });
});

// Dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database connecting...' });
        }
        
        const rooms = await db.collection('rooms').find({}).toArray();
        const bookings = await db.collection('bookings').find({}).toArray();
        
        const totalRooms = rooms.length;
        const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length;
        const vacantRooms = rooms.filter(r => r.status === 'Vacant').length;
        const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
        
        res.json({
            success: true,
            data: {
                totalRooms, occupiedRooms, vacantRooms,
                totalBookings: bookings.length,
                totalRevenue: totalRevenue,
                occupancyRate: totalRooms > 0 ? ((occupiedRooms / totalRooms) * 100).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Frontend routes
app.get('/admin', (req, res) => {
    if (req.session.isAdmin) {
        res.sendFile(path.join(__dirname, '../inaya-hotel/public/admin.html'));
    } else {
        res.sendFile(path.join(__dirname, '../inaya-hotel/public/index.html'));
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../inaya-hotel/public/index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin`);
    console.log(`🔍 Health: http://localhost:${PORT}/api/health\n`);
    await connectDB();
});

process.on('SIGINT', async () => {
    if (client) await client.close();
    process.exit(0);
});
