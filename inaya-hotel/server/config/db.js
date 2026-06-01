// server/config/db.js - Enhanced MongoDB Connection for Multi-Tenant SaaS
const mongoose = require('mongoose');

// Connection configuration for high-scale multi-tenant environment
const connectionOptions = {
  // Connection Pool Settings (for 1000+ concurrent guests)
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 50,    // Max connections
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 10,    // Min connections to keep alive
  maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME) || 30000, // Close idle connections after 30s

  // Timeout Settings
  serverSelectionTimeoutMS: 10000,  // Timeout for server selection
  socketTimeoutMS: 45000,           // Close sockets after 45s of inactivity
  connectTimeoutMS: 10000,          // Initial connection timeout

  // Retry Settings for resilience
  retryWrites: true,
  retryReads: true,

  // Network Settings
  family: 4, // Use IPv4, skip IPv6 for better compatibility

  // Multi-tenant: Ensure proper read/write concerns
  readPreference: process.env.MONGO_READ_PREF || 'primary',
  writeConcern: { w: 'majority', j: true, wtimeout: 5000 }
};

/**
 * Connect to MongoDB with enhanced error handling & monitoring
 * @param {string} uri - MongoDB connection URI from environment
 * @param {Object} options - Additional mongoose options (optional)
 * @returns {Promise<mongoose.Connection>} - Mongoose connection instance
 */
const connectDB = async (uri, options = {}) => {
  const mergedOptions = { ...connectionOptions, ...options };

  try {
    // Establish connection
    await mongoose.connect(uri, mergedOptions);

    const conn = mongoose.connection;

    console.log(`✅ MongoDB Connected: ${conn.host}`);
    console.log(`📦 Database: ${conn.name}`);
    console.log(`🔗 Pool: ${mergedOptions.minPoolSize}-${mergedOptions.maxPoolSize} connections`);

    // ========== EVENT LISTENERS FOR MONITORING ==========

    // Connection error handler
    conn.on('error', (err) => {
      console.error('❌ MongoDB Connection Error:', err.message);
      // Log to external monitoring service here (e.g., Sentry, Datadog)
    });

    // Disconnection handler (network issues, DB restart)
    conn.on('disconnected', () => {
      console.warn('⚠️ MongoDB Disconnected. Attempting auto-reconnect...');
      // Could trigger alert to ops team here
    });

    // Reconnection success handler
    conn.on('reconnected', () => {
      console.log('🔄 MongoDB Reconnected Successfully');
      // Could log reconnection metrics here
    });

    // Connection opened (initial or after reconnect)
    conn.on('open', () => {
      console.log('🔓 MongoDB Connection Open');
    });

    // Connection closed (graceful shutdown)
    conn.on('close', () => {
      console.log('🔒 MongoDB Connection Closed');
    });

    // Connection pool events (for monitoring scale)
    conn.on('connected', () => {
      console.log(`👥 Active Connections: ${conn.readyState}`);
    });

    return conn;

  } catch (error) {
    console.error('❌ MongoDB Connection Failed:', error.message);

    // Log detailed error for debugging
    if (error.code) console.error(`Error Code: ${error.code}`);
    if (error.errmsg) console.error(`Error Message: ${error.errmsg}`);

    // Exit process on startup failure (let process manager restart)
    // In production, use PM2/Docker for auto-restart
    process.exit(1);
  }
};

/**
 * Gracefully close MongoDB connection (for shutdown hooks)
 * @returns {Promise<void>}
 */
const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) { // 0 = disconnected
      await mongoose.disconnect();
      console.log('🔌 MongoDB Disconnected Gracefully');
    }
  } catch (error) {
    console.error('❌ Error during MongoDB disconnect:', error.message);
  }
};

/**
 * Get current connection status
 * @returns {Object} - Connection status info
 */
const getConnectionStatus = () => {
  const conn = mongoose.connection;
  return {
    readyState: conn.readyState, // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    host: conn.host,
    name: conn.name,
    port: conn.port,
    collections: Object.keys(conn.collections || {}),
    ready: conn.readyState === 1
  };
};

// Export for use in server startup and tests
module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus,
  mongoose // Export mongoose itself for schema definitions
};
