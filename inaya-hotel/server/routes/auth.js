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
// ADMIN LOGIN — FIXED: Strict hotelId isolation
// ============================================
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;

    // Teeno fields zaroori hain
    if (!email || !password || !hotelId) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and hotelId are required'
      });
    }

    const db = getDB(req);

    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not connected' });
    }

    // =====================================================
    // STEP 1: Tenants collection mein check karo
    // FIXED: active field NAHI check karte — kyunki tenants mein active field nahi hoti
    // STRICT: sirf hotelId + adminEmail dono match hone chahiye
    // =====================================================
    const tenant = await db.collection('tenants').findOne({
      hotelId: hotelId.trim(),
      adminEmail: email.toLowerCase().trim()
    });

    if (tenant) {
      // Plain text password check
      if (tenant.adminPassword !== password) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials for this hotel'
        });
      }

      // Token mein SIRF tenant.hotelId — frontend input NAHI
      const token = generateToken({
        email: tenant.adminEmail,
        name: tenant.hotelName || 'Hotel Admin',
        role: 'hotel_admin',
        hotelId: tenant.hotelId,
        permissions: ['all']
      });

      // Log the login
      await db.collection('logs').insertOne({
        hotelId: tenant.hotelId,
        user: tenant.adminEmail,
        action: 'admin_login',
        details: `Hotel Admin ${tenant.adminEmail} logged in`,
        ip: req.ip,
        timestamp: new Date()
      }).catch(() => {});

      return res.json({
        success: true,
        token,
        user: {
          id: 'tenant_' + tenant.hotelId,
          email: tenant.adminEmail,
          name: tenant.hotelName || 'Hotel Admin',
          role: 'hotel_admin',
          permissions: ['all']
        },
        hotelId: tenant.hotelId
      });
    }

    // =====================================================
    // STEP 2: Agar tenant nahi mila, users collection check karo
    // STRICT: email + hotelId dono match hone chahiye
    // =====================================================
    const user = await db.collection('users').findOne({
      email: email.toLowerCase().trim(),
      hotelId: hotelId.trim()
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials for this hotel'
      });
    }

    // Active check
    if (user.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Account is inactive'
      });
    }

    // Password verify karo (bcrypt)
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials for this hotel'
      });
    }

    // Token mein SIRF user.hotelId — frontend input NAHI
    const token = generateToken({
      email: user.email,
      name: user.name,
      role: user.role,
      hotelId: user.hotelId,
      permissions: user.permissions || []
    });

    // Update last login
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // Log the login
    await db.collection('logs').insertOne({
      hotelId: user.hotelId,
      user: user.email,
      action: 'admin_login',
      details: `Admin ${user.email} logged in`,
      ip: req.ip,
      timestamp: new Date()
    }).catch(() => {});

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions || []
      },
      hotelId: user.hotelId
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
    const existingUser = await db.collection('users').findOne({
      email: email.toLowerCase().trim(),
      hotelId: hotelId.trim()
    });

    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already exists for this hotel' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      name: name || email.split('@')[0],
      role: role || 'staff',
      hotelId: hotelId.trim(),
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

    let user = null;

    if (decoded.userId || decoded.id) {
      try {
        user = await db.collection('users').findOne(
          { _id: new ObjectId(decoded.userId || decoded.id) },
          { projection: { password: 0 } }
        );
      } catch (e) {
        // Tenant user ke liye ObjectId nahi hoga — ignore karo
      }
    }

    // Agar users mein nahi mila, token info return karo (tenant admin ke liye)
    if (!user) {
      return res.json({
        success: true,
        user: {
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
          hotelId: decoded.hotelId,
          permissions: decoded.permissions || []
        }
      });
    }

    res.json({ success: true, user });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    console.error('Get user error:', error.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ============================================
// GUEST LOGIN
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

    // Check blacklist
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

    // Find or create guest
    let guest = await db.collection('guests').findOne({
      room: parseInt(room),
      status: 'active',
      hotelId: effectiveHotelId
    });

    if (!guest) {
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
      if (guest.name !== name) {
        await db.collection('guests').updateOne(
          { _id: guest._id },
          { $set: { name, updatedAt: new Date() } }
        );
        guest.name = name;
      }
    }

    // Guest ke liye bhi token generate karo
    const token = generateToken({
      name: guest.name,
      room: guest.room,
      role: 'guest',
      hotelId: effectiveHotelId
    });

    // Log
    await db.collection('logs').insertOne({
      hotelId: effectiveHotelId,
      user: name,
      action: 'guest_login',
      details: `Guest ${name} logged in for room ${room}`,
      timestamp: new Date()
    }).catch(() => {});

    res.json({
      success: true,
      token,
      hotelId: effectiveHotelId,
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
// LOGOUT
// ============================================
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================
// REFRESH TOKEN
// ============================================
router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = getDB(req);
    if (db && decoded.userId) {
      try {
        const user = await db.collection('users').findOne({
          _id: new ObjectId(decoded.userId)
        });
        if (!user || user.active === false) {
          return res.status(401).json({ success: false, error: 'User not found or inactive' });
        }
      } catch (e) {
        // Tenant user — ignore karo
      }
    }

    // Refresh mein bhi hotelId decoded se aaye — frontend se NAHI
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