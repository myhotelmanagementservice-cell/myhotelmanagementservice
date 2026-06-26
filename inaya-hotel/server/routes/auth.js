const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Helper: Get DB instance from app
const getDB = (req) => req.app.get('db');

// Helper: Generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// ============================================
// ADMIN LOGIN
// ============================================
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;

    // ========== DEBUG LOGS ==========
    console.log('========== LOGIN DEBUG ==========');
    console.log('EMAIL:', email);
    console.log('PASSWORD:', password);
    console.log('HOTEL ID:', hotelId);

    const db = getDB(req);
    if (db) {
      const allTenants = await db.collection('tenants').find({}).toArray();
      console.log('ALL TENANTS:', allTenants.map(t => ({ hotelId: t.hotelId, adminEmail: t.adminEmail })));

      const tenant = await db.collection('tenants').findOne({
        adminEmail: email.toLowerCase().trim(),
        hotelId: hotelId,
        active: true
      });
      console.log('FOUND TENANT:', tenant ? { hotelId: tenant.hotelId, adminEmail: tenant.adminEmail } : 'NOT FOUND');
    }
    console.log('=================================');
    // ========== END DEBUG ==========

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    if (!db) {
      // Fallback for demo mode
      if (email === 'admin@crownplaza.com' && password === 'admin123') {
        const token = generateToken({
          email,
          name: 'Admin',
          role: 'super_admin',
          hotelId: hotelId || 'default',
          permissions: ['all']
        });
        return res.json({
          success: true,
          token,
          user: { email, name: 'Admin', role: 'super_admin', permissions: ['all'] },
          hotelId: hotelId || 'default'
        });
      }
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    // =====================================================
    // STEP 1: Check user in users collection
    // =====================================================
    let user = await db.collection('users').findOne({
      email: email.toLowerCase().trim(),
      hotelId: hotelId
    });

    // =====================================================
    // STEP 2: If not found, check tenants collection
    // =====================================================
    if (!user) {

      const tenant = await db.collection('tenants').findOne({
        adminEmail: email.toLowerCase().trim(),
        hotelId: hotelId,
        active: true
      });

      if (!tenant) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials for this hotel'
        });
      }

      // Plain text password check
      if (tenant.adminPassword !== password) {
        return res.status(401).json({
          success: false,
          error: 'Invalid password'
        });
      }

      // Create temporary user object from tenant
      user = {
        email: tenant.adminEmail,
        name: tenant.hotelName || 'Hotel Admin',
        role: 'hotel_admin',
        hotelId: tenant.hotelId,
        permissions: ['all'],
        active: true
      };
    }
    else {

      // Existing users collection password check
      const validPassword = await bcrypt.compare(
        password,
        user.password
      );

      if (!validPassword) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }
    }

    // Check if account is active
    if (user.active === false) {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    // Generate JWT token
    const token = generateToken({
      email: user.email,
      name: user.name,
      role: user.role,
      hotelId: hotelId || user.hotelId || 'default',
      permissions: user.permissions || []
    });

    // Update last login (only if user exists in users collection)
    if (user._id) {
      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date() } }
      );
    }

    // Log the login
    await db.collection('logs').insertOne({
      hotelId: hotelId || user.hotelId,
      user: email,
      action: 'admin_login',
      details: `Admin ${email} logged in`,
      ip: req.ip,
      timestamp: new Date()
    }).catch(() => {});

    res.json({
      success: true,
      token,
      user: {
        id: user._id || 'tenant_' + user.hotelId,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions || []
      },
      hotelId: hotelId || user.hotelId || 'default'
    });

  } catch (error) {
    console.error('Admin login error:', error.message);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
});

// ============================================
// ADMIN REGISTER (Super Admin Only)
// ============================================
router.post('/admin/register', async (req, res) => {
  try {
    const { name, email, password, role, hotelId, permissions } = req.body;

    if (!email || !password || !hotelId) {
      return res.status(400).json({ 
        success: false, 
        error: 'email, password, and hotelId are required' 
      });
    }

    const db = getDB(req);
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    // Check if user already exists for this hotel
    const existingUser = await db.collection('users').findOne({ email, hotelId });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already exists for this hotel' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      role: role || 'staff',
      hotelId,
      permissions: permissions || ['rooms', 'guests', 'food', 'inventory', 'requests'],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(user);
    user._id = result.insertedId;
    delete user.password;

    // Log the registration
    await db.collection('logs').insertOne({
      hotelId,
      user: 'system',
      action: 'user_registered',
      details: `New user ${email} registered for hotel ${hotelId}`,
      timestamp: new Date()
    }).catch(() => {});

    res.status(201).json({ 
      success: true, 
      message: 'User created successfully', 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        hotelId: user.hotelId 
      } 
    });

  } catch (error) {
    console.error('Admin register error:', error.message);
    res.status(500).json({ success: false, error: 'Server error during registration' });
  }
});

// ============================================
// GET CURRENT USER (/me)
// ============================================
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = getDB(req);
    if (!db) {
      // Return decoded token info for offline mode
      return res.json({ 
        success: true, 
        user: { 
          id: decoded.userId || decoded.id,
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
          hotelId: decoded.hotelId 
        } 
      });
    }

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(decoded.userId || decoded.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, user });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    if (error.name === 'ObjectId') {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }
    console.error('Get user error:', error.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ============================================
// GUEST LOGIN (Create or Find Guest)
// ============================================
router.post('/guest/login', async (req, res) => {
  try {
    const { name, room, hotelId } = req.body;

    if (!name || !room) {
      return res.status(400).json({ 
        success: false, 
        error: 'Name and room number are required' 
      });
    }

    const db = getDB(req);
    const effectiveHotelId = hotelId || req.headers['x-hotel-id'] || 'default';

    if (!db) {
      // Offline mode: return guest object without DB
      const guest = {
        _id: 'guest_' + Date.now(),
        name,
        room: parseInt(room),
        points: 50,
        status: 'active',
        checkin: new Date().toISOString(),
        hotelId: effectiveHotelId
      };
      return res.json({ success: true, guest });
    }

    // Check blacklist first
    const blacklisted = await db.collection('blacklist').findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      hotelId: effectiveHotelId 
    });

    if (blacklisted) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: Guest is blacklisted',
        reason: blacklisted.reason 
      });
    }

    // Find or create guest with hotelId scope
    let guest = await db.collection('guests').findOne({ 
      room: parseInt(room), 
      status: 'active',
      hotelId: effectiveHotelId 
    });

    if (!guest) {
      // Create new guest
      guest = {
        name,
        room: parseInt(room),
        points: 50,
        status: 'active',
        checkin: new Date(),
        hotelId: effectiveHotelId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const result = await db.collection('guests').insertOne(guest);
      guest._id = result.insertedId;
    } else {
      // Update existing guest name if changed
      if (guest.name !== name) {
        await db.collection('guests').updateOne(
          { _id: guest._id },
          { $set: { name, updatedAt: new Date() } }
        );
        guest.name = name;
      }
    }

    // Log guest login
    await db.collection('logs').insertOne({
      hotelId: effectiveHotelId,
      user: name,
      action: 'guest_login',
      details: `Guest ${name} logged in for room ${room}`,
      timestamp: new Date()
    }).catch(() => {});

    res.json({
      success: true,
      guest: {
        id: guest._id,
        name: guest.name,
        room: guest.room,
        points: guest.points,
        status: guest.status,
        hotelId: guest.hotelId
      }
    });

  } catch (error) {
    console.error('Guest login error:', error.message);
    res.status(500).json({ success: false, error: 'Server error during guest login' });
  }
});

// ============================================
// LOGOUT (Invalidate token client-side)
// ============================================
router.post('/logout', (req, res) => {
  // JWT is stateless, so logout is handled client-side by removing token
  // We can optionally maintain a token blacklist in Redis for immediate invalidation
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================
// REFRESH TOKEN (Optional)
// ============================================
router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists and is active
    const db = getDB(req);
    if (db && decoded.userId) {
      const user = await db.collection('users').findOne({ 
        _id: new ObjectId(decoded.userId) 
      });

      if (!user || user.active === false) {
        return res.status(401).json({ success: false, error: 'User not found or inactive' });
      }
    }

    // Generate new token with same payload
    const newToken = generateToken({
      userId: decoded.userId || decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      hotelId: decoded.hotelId,
      permissions: decoded.permissions
    });

    res.json({ success: true, token: newToken });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
    console.error('Token refresh error:', error.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;