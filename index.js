// server/index.js - Main Backend Server (Express + Socket.IO + Redis)
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import modules
const connectDB = require('./db/connect');
const authMiddleware = require('./middleware/auth');
const multitenantMiddleware = require('./middleware/multitenant');
const socketHandler = require('./socket/handler');
const authRoutes = require('./routes/auth');
const hotelRoutes = require('./routes/hotel');
const requestRoutes = require('./routes/request');
const bookingRoutes = require('./routes/booking');
const staffRoutes = require('./routes/staff');
const configRoutes = require('./routes/config');

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hotelSaaS';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

// ==================== APP SETUP ====================
const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(','),
  credentials: true
}));

// Rate limiting (prevent abuse)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (for Replit hosting)
if (NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client')));
}

// Health check endpoint (for process manager)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    socket: io?.engine?.clientsCount || 0,
    uptime: process.uptime()
  });
});

// API Routes (with multitenant middleware)
app.use('/api/auth', authRoutes);
app.use('/api/hotels', authMiddleware, multitenantMiddleware, hotelRoutes);
app.use('/api/requests', authMiddleware, multitenantMiddleware, requestRoutes);
app.use('/api/bookings', authMiddleware, multitenantMiddleware, bookingRoutes);
app.use('/api/staff', authMiddleware, multitenantMiddleware, staffRoutes);
app.use('/api/config', authMiddleware, multitenantMiddleware, configRoutes);

// Catch-all for SPA routing (if serving frontend)
if (NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
  });
}

// ==================== SOCKET.IO + REDIS SETUP ====================
let io;
let pubClient, subClient;

async function initSocketIO() {
  try {
    // Redis clients for adapter (required for scaling)
    pubClient = createClient({ url: REDIS_URL });
    subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log('✅ Redis connected for Socket.IO adapter');

    // Socket.IO with Redis adapter for horizontal scaling
    io = new Server(server, {
      cors: {
        origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(','),
        methods: ['GET', 'POST'],
        credentials: true
      },
      adapter: createAdapter(pubClient, subClient),
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Socket.IO middleware for auth
    io.use((socket, next) => {
      const hotelId = socket.handshake.auth?.hotelId;
      const token = socket.handshake.auth?.token;

      if (!hotelId) {
        return next(new Error('Missing hotelId'));
      }

      // Optional: Verify JWT token here if needed
      socket.hotelId = hotelId;
      socket.clientId = socket.handshake.auth?.clientId || socket.id;
      next();
    });

    // Register socket event handlers
    socketHandler(io);

    console.log('✅ Socket.IO initialized with Redis adapter');
  } catch (error) {
    console.error('❌ Socket.IO initialization failed:', error.message);
    console.warn('⚠️ Falling back to in-memory adapter (no scaling)');

    // Fallback: in-memory adapter (works but doesn't scale)
    io = new Server(server, {
      cors: {
        origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(','),
        credentials: true
      },
      transports: ['websocket', 'polling']
    });
    socketHandler(io);
  }
}

// ==================== DATABASE CONNECTION ====================
async function initDatabase() {
  try {
    await connectDB(MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

// ==================== START SERVER ====================
async function startServer() {
  try {
    // Init database first
    await initDatabase();

    // Init Socket.IO with Redis
    await initSocketIO();

    // Start HTTP server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);
      console.log(`📡 Socket.IO: ${io?.adapter?.constructor?.name || 'in-memory'}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('🔌 HTTP server closed');

    // Disconnect Redis
    if (pubClient) await pubClient.quit();
    if (subClient) await subClient.quit();
    console.log('🔌 Redis clients disconnected');

    // Disconnect MongoDB
    await mongoose.disconnect();
    console.log('🔌 MongoDB disconnected');

    // Disconnect all sockets
    if (io) {
      io.close();
      console.log('🔌 Socket.IO closed');
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

// ==================== ERROR HANDLING ====================
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// ==================== EXPORT FOR TESTING ====================
module.exports = { app, server, io };

// ==================== START ====================
if (require.main === module) {
  startServer();
}