const express = require('express');
const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

// Available ports to try
const availablePorts = [DEFAULT_PORT, 3001, 3002, 3003, 5000, 5001, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

app.get('/', (req, res) => {
  res.json({ message: 'Server running from workspace/server.js' });
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