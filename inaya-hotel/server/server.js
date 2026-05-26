require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://hotel:hotelinaya@cluster0.hauipx7.mongodb.net/inaya_hotel?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err.message));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'OK', message: 'Inaya Hotel Management System API' });
});

// Serve HTML Files - YEH IMPORTANT HAI!
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
});

// Auto Port Shift
const PORTS = [3000, 3001, 3002, 3003, 3005, 8080];
let currentPort = 0;

function startServer(port) {
    const server = app.listen(port, '0.0.0.0')
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                currentPort++;
                if (currentPort < PORTS.length) {
                    startServer(PORTS[currentPort]);
                }
            }
        })
        .on('listening', () => {
            console.log(`🚀 Server: http://localhost:${port}`);
            console.log(`👑 Admin: http://localhost:${port}/admin`);
            console.log(`🏨 Guest: http://localhost:${port}`);
        });
}

startServer(PORTS[currentPort]);
