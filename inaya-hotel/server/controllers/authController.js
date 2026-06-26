*const bcrypt = require('bcryptjs');
const { getDB, isConnected } = require('../config/db');
const { generateToken } = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

// Admin login
exports.adminLogin = async (req, res) => {
  try {
    const { email, password, hotelId } = req.body;
    console.log('🔐 Admin login attempt:', email, 'for hotel:', hotelId);

    // ✅ VALIDATION
    if (!email || !password) {
      return error(res, 'Email and password are required', 400);
    }

    if (!hotelId) {
      return error(res, 'Hotel ID is required', 400);
    }

    if (!isConnected()) {
      return error(res, 'Database connecting...', 503);
    }

    const db = getDB();

    // ✅ STEP 1: Verify hotel exists and is active
    const tenant = await db.collection('tenants').findOne({ hotelId });
    if (!tenant) {
      console.log('❌ Hotel not found:', hotelId);
      return error(res, 'Hotel not found. Please check Hotel ID.', 404);
    }

    if (tenant.active === false) {
      console.log('❌ Hotel is inactive:', hotelId);
      return error(res, 'Hotel account is inactive. Please contact support.', 403);
    }

    // ✅ STEP 2: Find user with STRICT hotelId match
    console.log('🔍 Looking for user:', email, 'in hotel:', hotelId);

    const user = await db.collection('users').findOne({ 
      email: email,
      hotelId: hotelId  // ✅ STRICT MATCH - no $or, no fallback
    });

    if (!user) {
      console.log('❌ User not found for hotel', hotelId, ':', email);

      // Helpful debug info
      const userAnyHotel = await db.collection('users').findOne({ email: email });
      if (userAnyHotel) {
        console.log('⚠️ User exists but belongs to different hotel:', userAnyHotel.hotelId);
        return error(res, `This account belongs to hotel ${userAnyHotel.hotelId}, not ${hotelId}`, 403);
      }

      return error(res, 'Invalid credentials for this hotel', 401);
    }

    // ✅ STEP 3: Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('❌ Wrong password for:', email);
      return error(res, 'Invalid password', 401);
    }

    // ✅ STEP 4: Check if user is active
    if (user.active === false) {
      return error(res, 'Account is inactive', 403);
    }

    // ✅ STEP 5: Generate token with correct hotelId
    const token = generateToken({
      email: user.email,
      name: user.name,
      role: user.role,
      hotelId: hotelId,  // ✅ Use the requested hotelId
      permissions: user.permissions
    });

    // ✅ STEP 6: Set session
    req.session.isAdmin = true;
    req.session.adminEmail = email;
    req.session.hotelId = hotelId;
    req.session.user = { 
      email: user.email, 
      name: user.name, 
      role: user.role, 
      permissions: user.permissions 
    };

    console.log('✅ Admin login successful:', email, 'for hotel:', hotelId);

    return success(res, {
      token,
      user: { 
        email: user.email, 
        name: user.name, 
        role: user.role,
        hotelId: hotelId,
        permissions: user.permissions
      },
      hotelId: hotelId,
      hotelName: tenant.hotelName || 'Hotel'
    }, 'Login successful');

  } catch (err) {
    console.error('❌ Login error:', err);
    return error(res, 'Login failed: ' + err.message, 500);
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
    } catch (e) {
      console.warn('Token verification failed:', e.message);
    }
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