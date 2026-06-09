const bcrypt = require('bcryptjs');
const { getDB, isConnected } = require('../config/db');
const { generateToken } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

// Admin login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;
    console.log('🔐 Admin login attempt:', email, 'for hotel:', hotelId);

    if (!isConnected()) {
      if (email === 'admin@crownplaza.com' && password === 'admin123') {
        const token = generateToken({
          email,
          name: 'Admin',
          role: 'super_admin',
          hotelId: hotelId || 'default',
          permissions: ['rooms', 'guests', 'food', 'inventory', 'requests', 'settings']
        });
        req.session.isAdmin = true;
        req.session.adminEmail = email;
        req.session.hotelId = hotelId || 'default';
        return success(res, {
          token,
          user: { email, name: 'Admin', role: 'super_admin', permissions: ['all'] },
          hotelId: hotelId || 'default'
        }, 'Login successful');
      }
      return error(res, 'Database connecting...', 503);
    }

    const db = getDB();

    if (hotelId && hotelId !== 'default') {
      const tenant = await db.collection('tenants').findOne({ hotelId });
      if (!tenant) {
        await db.collection('tenants').insertOne({
          hotelId,
          hotelName: 'New Hotel',
          currency: 'USD',
          currencySymbol: '$',
          language: 'en',
          country: 'Unknown',
          active: true,
          theme: 'default',
          subscriptionType: 'basic',
          createdAt: new Date()
        });
      }
    }

    const user = await db.collection('users').findOne({ 
      email: email,
      $or: [{ hotelId }, { hotelId: { $exists: false } }]
    });

    if (!user) {
      return error(res, 'Invalid credentials', 401);
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return error(res, 'Invalid credentials', 401);
    }

    if (!user.active) {
      return error(res, 'Account is inactive', 403);
    }

    const token = generateToken({
      email: user.email,
      name: user.name,
      role: user.role,
      hotelId: hotelId || user.hotelId || 'default',
      permissions: user.permissions
    });

    req.session.isAdmin = true;
    req.session.adminEmail = email;
    req.session.hotelId = hotelId || user.hotelId || 'default';
    req.session.user = { email: user.email, name: user.name, role: user.role, permissions: user.permissions };

    console.log('✅ Admin login successful:', email);

    return success(res, {
      token,
      user: { 
        email: user.email, 
        name: user.name, 
        role: user.role,
        permissions: user.permissions
      },
      hotelId: hotelId || user.hotelId || 'default'
    }, 'Login successful');

  } catch (err) {
    console.error('Login error:', err);
    return error(res, err.message, 500);
  }
};

// Check session
exports.checkSession = (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-key-change-in-production');
      return success(res, { 
        isAdmin: true, 
        email: decoded.email,
        hotelId: decoded.hotelId,
        role: decoded.role
      });
    } catch (e) {}
  }

  if (req.session.isAdmin) {
    return success(res, { 
      isAdmin: true, 
      email: req.session.adminEmail,
      hotelId: req.session.hotelId || 'default'
    });
  } else {
    return success(res, { isAdmin: false }, 'No active session');
  }
};

// Logout
exports.logout = (req, res) => {
  req.session.destroy();
  return success(res, null, 'Logged out');
};