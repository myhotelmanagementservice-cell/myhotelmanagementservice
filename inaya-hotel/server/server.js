require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// IMPORTANT: Static files serve karna - Sahi path do
const publicPath = path.join(__dirname, '../public');
console.log('📁 Public folder path:', publicPath);
app.use(express.static(publicPath));

// MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected'));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Inaya Hotel Management System API' });
});

// HTML Routes - YEH MOST IMPORTANT HAI!
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});

// Auto port shift
const PORTS = [3000, 3001, 3002, 3003, 3005, 8080];
let idx = 0;

function start(p) {
    const srv = app.listen(p, '0.0.0.0')
        .on('error', () => { idx++; if (idx < PORTS.length) start(PORTS[idx]); })
        .on('listening', () => {
            console.log(`🚀 Server: http://localhost:${p}`);
            console.log(`👑 Admin: http://localhost:${p}/admin`);
            console.log(`🏨 Guest: http://localhost:${p}`);
        });
}
start(PORTS[idx]);
