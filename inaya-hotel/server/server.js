require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// IMPORTANT: Static files serve karo
const publicPath = path.join(__dirname, '../public');
console.log('📁 Public folder:', publicPath);
app.use(express.static(publicPath));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected')).catch(err => console.log('MongoDB error:', err.message));

// API route
app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Inaya Hotel Management System API' });
});

// ============ HTML ROUTES - YE IMPORTANT HAI ============
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});

// ============ API ROUTES ============
app.get('/api/rooms', (req, res) => {
    const rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    res.json({ success: true, data: rooms });
});

app.post('/api/rooms', (req, res) => {
    const rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    const newRoom = { ...req.body, _id: Date.now().toString() };
    rooms.push(newRoom);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true, data: newRoom });
});

app.put('/api/rooms/:id', (req, res) => {
    let rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    rooms = rooms.map(r => r._id === req.params.id ? { ...r, ...req.body } : r);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true });
});

app.delete('/api/rooms/:id', (req, res) => {
    let rooms = JSON.parse(localStorage.getItem('rooms') || '[]');
    rooms = rooms.filter(r => r._id !== req.params.id);
    localStorage.setItem('rooms', JSON.stringify(rooms));
    res.json({ success: true });
});

app.get('/api/food', (req, res) => {
    const food = JSON.parse(localStorage.getItem('food') || '[]');
    res.json({ success: true, data: food });
});

app.post('/api/food', (req, res) => {
    const food = JSON.parse(localStorage.getItem('food') || '[]');
    const newItem = { ...req.body, _id: Date.now().toString() };
    food.push(newItem);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true, data: newItem });
});

app.put('/api/food/:id', (req, res) => {
    let food = JSON.parse(localStorage.getItem('food') || '[]');
    food = food.map(f => f._id === req.params.id ? { ...f, ...req.body } : f);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true });
});

app.delete('/api/food/:id', (req, res) => {
    let food = JSON.parse(localStorage.getItem('food') || '[]');
    food = food.filter(f => f._id !== req.params.id);
    localStorage.setItem('food', JSON.stringify(food));
    res.json({ success: true });
});

app.get('/api/requests', (req, res) => {
    const requests = JSON.parse(localStorage.getItem('requests') || '[]');
    res.json({ success: true, data: requests });
});

app.post('/api/requests', (req, res) => {
    const requests = JSON.parse(localStorage.getItem('requests') || '[]');
    const newRequest = { ...req.body, _id: Date.now().toString(), createdAt: new Date().toISOString() };
    requests.unshift(newRequest);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true, data: newRequest });
});

app.put('/api/requests/:id', (req, res) => {
    let requests = JSON.parse(localStorage.getItem('requests') || '[]');
    requests = requests.map(r => r._id === req.params.id ? { ...r, ...req.body, updatedAt: new Date().toISOString() } : r);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true });
});

app.delete('/api/requests/:id', (req, res) => {
    let requests = JSON.parse(localStorage.getItem('requests') || '[]');
    requests = requests.filter(r => r._id !== req.params.id);
    localStorage.setItem('requests', JSON.stringify(requests));
    res.json({ success: true });
});

app.get('/api/inventory', (req, res) => {
    const inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    res.json({ success: true, data: inventory });
});

app.post('/api/inventory', (req, res) => {
    const inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    const newItem = { ...req.body, _id: Date.now().toString() };
    inventory.push(newItem);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true, data: newItem });
});

app.put('/api/inventory/:id', (req, res) => {
    let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    inventory = inventory.map(i => i._id === req.params.id ? { ...i, ...req.body } : i);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true });
});

app.delete('/api/inventory/:id', (req, res) => {
    let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
    inventory = inventory.filter(i => i._id !== req.params.id);
    localStorage.setItem('inventory', JSON.stringify(inventory));
    res.json({ success: true });
});

app.get('/api/guests', (req, res) => {
    const guests = JSON.parse(localStorage.getItem('guests') || '[]');
    res.json({ success: true, data: guests });
});

app.post('/api/guests', (req, res) => {
    const guests = JSON.parse(localStorage.getItem('guests') || '[]');
    const newGuest = { ...req.body, _id: Date.now().toString(), checkIn: new Date().toISOString() };
    guests.push(newGuest);
    localStorage.setItem('guests', JSON.stringify(guests));
    res.json({ success: true, data: newGuest });
});

app.get('/api/blacklist', (req, res) => {
    const blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    res.json({ success: true, data: blacklist });
});

app.post('/api/blacklist', (req, res) => {
    const blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    const newEntry = { ...req.body, _id: Date.now().toString(), blockedAt: new Date().toISOString() };
    blacklist.push(newEntry);
    localStorage.setItem('blacklist', JSON.stringify(blacklist));
    res.json({ success: true, data: newEntry });
});

app.delete('/api/blacklist/:id', (req, res) => {
    let blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
    blacklist = blacklist.filter(b => b._id !== req.params.id);
    localStorage.setItem('blacklist', JSON.stringify(blacklist));
    res.json({ success: true });
});

app.get('/api/transport', (req, res) => {
    const transport = JSON.parse(localStorage.getItem('transport') || '[]');
    res.json({ success: true, data: transport });
});

app.post('/api/transport', (req, res) => {
    const transport = JSON.parse(localStorage.getItem('transport') || '[]');
    const newService = { ...req.body, _id: Date.now().toString() };
    transport.push(newService);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true, data: newService });
});

app.put('/api/transport/:id', (req, res) => {
    let transport = JSON.parse(localStorage.getItem('transport') || '[]');
    transport = transport.map(t => t._id === req.params.id ? { ...t, ...req.body } : t);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true });
});

app.delete('/api/transport/:id', (req, res) => {
    let transport = JSON.parse(localStorage.getItem('transport') || '[]');
    transport = transport.filter(t => t._id !== req.params.id);
    localStorage.setItem('transport', JSON.stringify(transport));
    res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
    const settings = JSON.parse(localStorage.getItem('settings') || '{"name":"Inaya Hotel","currencySymbol":"$","wifiPassword":"Inaya@2024"}');
    res.json({ success: true, data: settings });
});

app.put('/api/settings', (req, res) => {
    localStorage.setItem('settings', JSON.stringify(req.body));
    res.json({ success: true, data: req.body });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`👑 Admin: http://localhost:${PORT}/admin`);
    console.log(`🏨 Guest: http://localhost:${PORT}`);
});
