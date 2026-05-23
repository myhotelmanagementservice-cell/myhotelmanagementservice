require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/inaya_hotel')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api', (req, res) => {
  res.json({ name: 'Crown Plaza Hotel System', version: '5.0.0', status: 'running' });
});

// Auth Routes
app.use('/api/auth', require('./routes/auth'));

// Serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('/admin-panel.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin-panel.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  👑 Crown Plaza Hotel Server
  🚀 Port: ${PORT}
  🏥 Health: http://localhost:${PORT}/api/health
  🖥️  UI: http://localhost:${PORT}
  🔐 Admin: admin@crownplaza.com / admin123
  `);
});
