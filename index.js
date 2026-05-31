// index.js - Main Entry Point for Replit (Enhanced)
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ==================== CONFIGURATION ====================
const CONFIG = {
  serverPath: path.join(__dirname, 'server/server.js'),
  maxRestarts: 3,
  restartDelay: 2000,
  healthCheckInterval: 30000,
  envFile: path.join(__dirname, '.env')
};

let serverProcess = null;
let restartCount = 0;
let isShuttingDown = false;

// ==================== LOGGING ====================
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err || ''),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[✓] ${new Date().toISOString()} - ${msg}`)
};

// ==================== ENVIRONMENT VALIDATION ====================
function validateEnv() {
  const required = ['MONGODB_URI', 'JWT_SECRET', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    log.warn(`Missing environment variables: ${missing.join(', ')}`);
    log.info('Using default values for development');
  }

  // Set defaults for development
  if (!process.env.PORT) process.env.PORT = '3000';
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
  if (!process.env.FRONTEND_URL) process.env.FRONTEND_URL = '*';

  log.success('Environment validated');
}

// ==================== HEALTH CHECK ====================
async function checkHealth() {
  if (isShuttingDown) return;

  try {
    const port = process.env.PORT || 3000;
    const response = await fetch(`http://localhost:${port}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === 'OK') {
        log.info(`Health check passed - MongoDB: ${data.mongodb}, Clients: ${data.socket}`);
        restartCount = 0; // Reset restart counter on successful health check
        return true;
      }
    }
    log.warn('Health check failed - server not responding correctly');
    return false;
  } catch (error) {
    log.warn(`Health check error: ${error.message}`);
    return false;
  }
}

// ==================== START SERVER ====================
function startServer() {
  if (isShuttingDown) return;

  log.info(`Starting server: ${CONFIG.serverPath}`);
  log.info(`Environment: ${process.env.NODE_ENV}, Port: ${process.env.PORT}`);

  serverProcess = spawn('node', [CONFIG.serverPath], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
    cwd: __dirname
  });

  serverProcess.on('spawn', () => {
    log.success(`Server spawned with PID: ${serverProcess.pid}`);
    restartCount = 0;
  });

  serverProcess.on('error', (err) => {
    log.error('Failed to spawn server process', err);
    handleRestart();
  });

  serverProcess.on('close', (code, signal) => {
    log.info(`Server process closed - Code: ${code}, Signal: ${signal}`);

    if (isShuttingDown) {
      log.info('Graceful shutdown complete');
      return;
    }

    if (code !== 0 && code !== null) {
      log.warn(`Server exited with code ${code}`);
    }

    handleRestart();
  });

  // Forward signals to child process
  process.on('SIGUSR1', () => serverProcess.kill('SIGUSR1'));
  process.on('SIGUSR2', () => serverProcess.kill('SIGUSR2'));
}

// ==================== RESTART LOGIC ====================
function handleRestart() {
  if (isShuttingDown) return;

  restartCount++;

  if (restartCount <= CONFIG.maxRestarts) {
    log.warn(`Attempting restart ${restartCount}/${CONFIG.maxRestarts} in ${CONFIG.restartDelay}ms...`);
    setTimeout(() => {
      if (!isShuttingDown) {
        startServer();
      }
    }, CONFIG.restartDelay);
  } else {
    log.error(`Max restarts (${CONFIG.maxRestarts}) reached. Giving up.`);
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;

  isShuttingDown = true;
  log.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop health checks
  if (global.healthCheckInterval) {
    clearInterval(global.healthCheckInterval);
  }

  // Kill server process gracefully
  if (serverProcess && !serverProcess.killed) {
    log.info('Sending SIGTERM to server process...');
    serverProcess.kill('SIGTERM');

    // Force kill after timeout
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        log.warn('Force killing server process...');
        serverProcess.kill('SIGKILL');
      }
    }, 10000);
  }

  // Close any open resources
  log.info('Cleanup complete. Exiting.');
  process.exit(0);
}

// ==================== INITIALIZATION ====================
function init() {
  log.info('🚀 Inaya Hotel Management System - Replit Entry Point');
  log.info(`📁 Working directory: ${__dirname}`);
  log.info(`📦 Node version: ${process.version}`);

  // Validate environment
  validateEnv();

  // Check if server.js exists
  if (!fs.existsSync(CONFIG.serverPath)) {
    log.error(`Server file not found: ${CONFIG.serverPath}`);
    process.exit(1);
  }

  // Start the server
  startServer();

  // Start health check interval (only in production)
  if (process.env.NODE_ENV === 'production') {
    global.healthCheckInterval = setInterval(checkHealth, CONFIG.healthCheckInterval);
    log.info(`Health checks enabled every ${CONFIG.healthCheckInterval/1000}s`);
  }

  // Setup signal handlers
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGHUP', () => {
    log.info('Received SIGHUP - restarting server...');
    if (serverProcess) serverProcess.kill('SIGHUP');
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    log.error('Uncaught Exception', err);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  log.success('✅ Initialization complete. Server starting...');
}

// ==================== START ====================
init();