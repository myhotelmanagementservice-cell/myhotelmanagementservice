// Main entry point for Replit
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Inaya Hotel Server...');
console.log('📦 Loading environment variables...');

// Run the main server
const server = spawn('node', ['server/server.js'], {
    stdio: 'inherit',
    env: process.env
});

server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

process.on('SIGINT', () => {
    server.kill('SIGINT');
    process.exit(0);
});
