require('dotenv').config();
const express = require('express');
const path = require("path");
const mongoose = require('mongoose');
const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

// Available ports to try
const availablePorts = [DEFAULT_PORT, 3001, 3002, 3003, 5000, 5001, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

app.get('/', (req, res) => {
  res.json({ message: 'Server running from workspace/server.js', mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'OK', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Auto port fallback function
function startServer() {
  if (currentPortIndex >= availablePorts.length) {
    console.error('❌ No available ports found!');
    process.exit(1);
  }

  const port = availablePorts[currentPortIndex];
  
  const server = app.listen(port, '0.0.0.0')
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${port} is busy, trying next port...`);
        currentPortIndex++;
        startServer();
      } else {
        console.error('❌ Server error:', err);
        process.exit(1);
      }
    })
    .on('listening', () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`✅ MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    });
}

// Start server with auto fallback
startServer();

// Serve static files from public directory
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});
