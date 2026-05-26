require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ============ MIDDLEWARE ============
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3005', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ============ MONGODB CONNECTION ============
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Error:', err.message));

// ============ API ROUTES ============
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'OK', 
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Rooms API
app.get('/api/rooms', async (req, res) => {
    const rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    res.json({ success: true, data: rooms });
});
app.post('/api/rooms', async (req, res) => {
    const rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    const newRoom = { ...req.body, _id: Date.now().toString() };
    rooms.push(newRoom);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true, data: newRoom });
});
app.put('/api/rooms/:id', async (req, res) => {
    let rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    rooms = rooms.map(r => r._id === req.params.id ? { ...r, ...req.body } : r);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true });
});
app.delete('/api/rooms/:id', async (req, res) => {
    let rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    rooms = rooms.filter(r => r._id !== req.params.id);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true });
});

// Food API
app.get('/api/food', async (req, res) => {
    const food = JSON.parse(localStorage.getItem('food') || '[]');
    res.json({ success: true, data: food });
});
app.post('/api/food', async (req, res) => {
    const food = JSON.parse(localStorage.getItem('food') || '[]');
    const newItem = { ...req.body, _id: Date.now().toString() };
    food.push(newItem);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true, data: newItem });
});
app.put('/api/food/:id', async (req, res) => {
    let food = JSON.parse(localStorage.getItem('food') || '[]');
    food = food.map(f => f._id === req.params.id ? { ...f, ...req.body } : f);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true });
});
app.delete('/api/food/:id', async (req, res) => {
    let food = JSON.parse(localStorage.getItem('food') || '[]');
    food = food.filter(f => f._id !== req.params.id);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true });
});

// Requests API
app.get('/api/requests', async (req, res) => {
    const requests = JSON.parse(localStorage.getItem('requests') || '[]');
    res.json({ success: true, data: requests });
});
app.post('/api/requests', async (req, res) => {
    const requests = JSON.parse(localStorage.getItem('requests') || '[]');
    const newRequest = { ...req.body, _id: Date.now().toString(), createdAt: new Date().toISOString() };
    requests.unshift(newRequest);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true, data: newRequest });
});
app.put('/api/requests/:id', async (req, res) => {
    let requests = JSON.parse(localStorage.getItem('requests') || '[]');
    requests = requests.map(r => r._id === req.params.id ? { ...r, ...req.body, updatedAt: new Date().toISOString() } : r);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true });
});
app.delete('/api/requests/:id', async (req, res) => {
    let requests = JSON.parse(localStorage.getItem('requests') || '[]');
    requests = requests.filter(r => r._id !== req.params.id);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true });
});

// Inventory API
app.get('/api/inventory', async (req, res) => {
    const inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    res.json({ success: true, data: inventory });
});
app.post('/api/inventory', async (req, res) => {
    const inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    const newItem = { ...req.body, _id: Date.now().toString() };
    inventory.push(newItem);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true, data: newItem });
});
app.put('/api/inventory/:id', async (req, res) => {
    let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    inventory = inventory.map(i => i._id === req.params.id ? { ...i, ...req.body } : i);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true });
});
app.delete('/api/inventory/:id', async (req, res) => {
    let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    inventory = inventory.filter(i => i._id !== req.params.id);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true });
});

// Guests API
app.get('/api/guests', async (req, res) => {
    const guests = JSON.parse(localStorage.getItem('guests') || '[]');
    res.json({ success: true, data: guests });
});
app.post('/api/guests', async (req, res) => {
    const guests = JSON.parse(localStorage.getItem('guests') || '[]');
    const newGuest = { ...req.body, _id: Date.now().toString(), checkIn: new Date().toISOString() };
    guests.push(newGuest);
    localStorage.setItem('guests', JSON.stringify(guests));
    res.json({ success: true, data: newGuest });
});

// Blacklist API
app.get('/api/blacklist', async (req, res) => {
    const blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    res.json({ success: true, data: blacklist });
});
app.post('/api/blacklist', async (req, res) => {
    const blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    const newEntry = { ...req.body, _id: Date.now().toString(), blockedAt: new Date().toISOString() };
    blacklist.push(newEntry);
    localStorage.setItem('blacklist', JSON.stringify(blacklist));
    res.json({ success: true, data: newEntry });
});
app.delete('/api/blacklist/:id', async (req, res) => {
    let blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    blacklist = blacklist.filter(b => b._id !== req.params.id);
    localStorage.setItem('blacklist', JSON.stringify(blacklist));
    res.json({ success: true });
});

// Transport API
app.get('/api/transport', async (req, res) => {
    const transport = JSON.parse(localStorage.getItem('transport') || '[]');
    res.json({ success: true, data: transport });
});
app.post('/api/transport', async (req, res) => {
    const transport = JSON.parse(localStorage.getItem('transport') || '[]');
    const newService = { ...req.body, _id: Date.now().toString() };
    transport.push(newService);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true, data: newService });
});
app.put('/api/transport/:id', async (req, res) => {
    let transport = JSON.parse(localStorage.getItem('transport') || '[]');
    transport = transport.map(t => t._id === req.params.id ? { ...t, ...req.body } : t);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true });
});
app.delete('/api/transport/:id', async (req, res) => {
    let transport = JSON.parse(localStorage.getItem('transport') || '[]');
    transport = transport.filter(t => t._id !== req.params.id);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true });
});

// Settings API
app.get('/api/settings', async (req, res) => {
    const settings = JSON.parse(localStorage.getItem('settings') || '{"name":"Inaya Hotel","currencySymbol":"$","wifiPassword":"Inaya@2024"}');
    res.json({ success: true, data: settings });
});
app.put('/api/settings', async (req, res) => {
    localStorage.setItem('settings', JSON.stringify(req.body));
    res.json({ success: true, data: req.body });
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ============ AUTO PORT SHIFT LOGIC ============
const AVAILABLE_PORTS = [3000, 3001, 3002, 3003, 3005, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

function startServer(port) {
    const server = app.listen(port, '0.0.0.0')
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`⚠️ Port ${port} is busy, trying next port...`);
                currentPortIndex++;
                if (currentPortIndex < AVAILABLE_PORTS.length) {
                    startServer(AVAILABLE_PORTS[currentPortIndex]);
                } else {
                    console.error('❌ No available ports found!');
                    process.exit(1);
                }
            } else {
                console.error('❌ Server error:', err);
                process.exit(1);
            }
        })
        .on('listening', () => {
            console.log(`🚀 Server running on http://localhost:${port}`);
            console.log(`👑 Admin Panel: http://localhost:${port}/admin`);
            console.log(`🏨 Guest Panel: http://localhost:${port}`);
        });
}

startServer(AVAILABLE_PORTS[currentPortIndex]);
