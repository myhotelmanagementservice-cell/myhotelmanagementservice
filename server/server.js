const express = require('express');
const mongoose = require('mongoose');
const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

// Available ports to try
const availablePorts = [DEFAULT_PORT, 3001, 3002, 3003, 5000, 5001, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/inaya-hotel', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected successfully'))
.catch(err => console.error('❌ MongoDB Connection error:', err));

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Inaya Hotel Management System API' });
});

// Test MongoDB connection route
app.get('/test-db', (req, res) => {
  const state = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  res.json({ 
    mongodb_status: states[state],
    server_status: 'running'
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
    });
}

// Start server with auto fallback
startServer();
