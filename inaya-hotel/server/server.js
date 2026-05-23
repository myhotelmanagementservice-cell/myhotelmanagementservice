require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

const availablePorts = [DEFAULT_PORT, 3001, 3002, 3003, 5000, 5001, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'OK', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Auto port fallback
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
    });
}

startServer();

// API Routes
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/blacklist', require('./routes/blacklist'));
app.use('/api/food', require('./routes/food'));
app.use('/api/requests', require('./routes/requests'));

// Register all API routes
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/guests', require('./routes/guests'));
app.use('/api/food', require('./routes/food'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/blacklist', require('./routes/blacklist'));
