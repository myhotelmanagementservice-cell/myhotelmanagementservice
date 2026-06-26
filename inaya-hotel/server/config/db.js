// server/config/db.js - Native MongoDB Driver Connection
const { MongoClient } = require('mongodb');

// ========== CONNECTION STATE ==========
let client = null;
let db = null;
let isConnected = false;

// ========== CONNECTION OPTIONS ==========
const connectionOptions = {
  // Connection Pool Settings
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 100,
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 20,
  maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME) || 30000,

  // Timeout Settings
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,

  // Retry Settings
  retryWrites: true,
  retryReads: true,

  // Compression (faster data transfer)
  compressors: ['zstd', 'zlib'],

  // Network
  family: 4
};

/**
 * Connect to MongoDB with native driver
 * @param {string} uri - MongoDB connection URI
 * @param {string} dbName - Database name
 * @returns {Promise<Object>} - Database instance
 */
const connectDB = async (uri, dbName = 'inaya_hotel') => {
  try {
    if (client && isConnected) {
      console.log('✅ MongoDB already connected');
      return db;
    }

    console.log('🔄 Connecting to MongoDB...');

    client = new MongoClient(uri, connectionOptions);
    await client.connect();

    db = client.db(dbName);
    isConnected = true;

    console.log(`✅ MongoDB Connected: ${client.s.options.hosts[0]}`);
    console.log(`📦 Database: ${dbName}`);
    console.log(`🔗 Pool: ${connectionOptions.minPoolSize}-${connectionOptions.maxPoolSize} connections`);

    // ========== EVENT LISTENERS ==========
    client.on('close', () => {
      console.warn('⚠️ MongoDB connection closed');
      isConnected = false;
    });

    client.on('error', (err) => {
      console.error('❌ MongoDB client error:', err.message);
      isConnected = false;
    });

    client.on('timeout', () => {
      console.warn('⚠️ MongoDB connection timeout');
    });

    return db;

  } catch (error) {
    console.error('❌ MongoDB Connection Failed:', error.message);
    isConnected = false;
    throw error;
  }
};

/**
 * Get database instance
 * @returns {Object|null} - MongoDB database instance
 */
const getDB = () => {
  if (!db || !isConnected) {
    console.warn('⚠️ getDB() called but database not connected');
    return null;
  }
  return db;
};

/**
 * Check if database is connected
 * @returns {boolean} - Connection status
 */
const isDBConnected = () => {
  return isConnected && db !== null;
};

/**
 * Get MongoDB client instance (for advanced operations)
 * @returns {MongoClient|null}
 */
const getClient = () => {
  return client;
};

/**
 * Gracefully disconnect from MongoDB
 * @returns {Promise<void>}
 */
const disconnectDB = async () => {
  try {
    if (client) {
      await client.close();
      client = null;
      db = null;
      isConnected = false;
      console.log('🔌 MongoDB Disconnected Gracefully');
    }
  } catch (error) {
    console.error('❌ Error during disconnect:', error.message);
  }
};

/**
 * Get connection status info
 * @returns {Object} - Connection status
 */
const getConnectionStatus = () => {
  return {
    connected: isConnected,
    database: db ? db.databaseName : null,
    client: client ? 'initialized' : 'not initialized'
  };
};

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
  try {
    if (!db) return false;
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    return false;
  }
};

// ========== EXPORTS ==========
module.exports = {
  connectDB,
  getDB,
  getClient,
  disconnectDB,
  getConnectionStatus,
  testConnection,
  // ✅ Alias for backward compatibility
  isConnected: isDBConnected
};