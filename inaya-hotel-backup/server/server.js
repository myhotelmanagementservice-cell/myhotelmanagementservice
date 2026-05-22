cat > server/server.js << 'EOF'
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// ============================================
// AUTO PORT CONFIGURATION WITH FALLBACK
// ============================================
const DEFAULT_PORT = process.env.PORT || 3000;
const availablePorts = [DEFAULT_PORT, 3001, 3002, 3003, 5000, 5001, 8080, 8081, 8888, 9000];
let currentPortIndex = 0;

// ============================================
// MONGODB CONNECTION (AUTO-RECONNECT)
// ============================================
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦 Database: ${conn.connection.name}`);
    return true;
  } catch (err) {
    console.error(`❌ MongoDB Error: ${err.message}`);
    console.log('⚠️ Retrying MongoDB connection in 5 seconds...');
    setTimeout(connectDB, 5000);
    return false;
  }
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '../public')));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { success: false, error: 'Too many requests. Try again later.' }
});
app.use('/api', limiter);

// ============================================
// MULTI-TENANT MIDDLEWARE
// ============================================
const getHotelId = (req) => {
  return req.headers['x-hotel-id'] || req.query.hotelId || process.env.DEFAULT_HOTEL_ID || 'INH001';
};

app.use('/api', (req, res, next) => {
  req.hotelId = getHotelId(req);
  res.setHeader('X-Hotel-Id', req.hotelId);
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  res.json({
    success: true,
    status: 'OK',
    hotelId: req.hotelId,
    database: dbStatus,
    port: currentPort,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// API ROUTES
// ============================================
app.get('/api', (req, res) => {
  res.json({
    name: 'Inaya Hotel Management System',
    version: '4.0.0',
    status: 'running',
    hotelId: req.hotelId,
    endpoints: {
      health: '/api/health',
      admin: '/api/admin',
      requests: '/api/requests'
    }
  });
});

// Admin Routes (will be added when files exist)
try {
  app.use('/api/admin', require('./routes/admin'));
  console.log('✅ Admin routes loaded');
} catch (err) {
  console.log('⚠️ Admin routes not yet created');
}

try {
  app.use('/api/requests', require('./routes/requests'));
  console.log('✅ Request routes loaded');
} catch (err) {
  console.log('⚠️ Request routes not yet created');
}

// ============================================
// SPA FALLBACK
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// ============================================
// AUTO PORT FALLBACK FUNCTION
// ============================================
let currentPort = null;

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
      currentPort = port;
      console.log('\n' + '='.repeat(50));
      console.log('🏨 INAYA HOTEL MANAGEMENT SYSTEM');
      console.log('='.repeat(50));
      console.log(`🚀 Server running on port: ${port}`);
      console.log(`🔗 Local: http://localhost:${port}`);
      console.log(`🏥 Health: http://localhost:${port}/api/health`);
      console.log(`👑 Admin: http://localhost:${port}/admin-panel.html`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🏨 Hotel ID Header: X-Hotel-Id`);
      console.log('='.repeat(50) + '\n');
    });
}

// ============================================
// START APPLICATION
// ============================================
const startApp = async () => {
  await connectDB();
  startServer();
};

startApp();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️ Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed');
  process.exit(0);
});
EOF