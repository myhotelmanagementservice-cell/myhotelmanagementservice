const { getDB, isConnected } = require('../config/db');

// Subscription expiry validation middleware
const checkSubscription = async (req, res, next) => {
  try {
    const hotelId = req.hotelId;
    if (hotelId === 'default') return next();
    if (!isConnected()) return next();

    const db = getDB();
    const tenant = await db.collection('tenants').findOne({ hotelId });

    if (!tenant) return next();

    if (!tenant.active) {
      return res.status(403).json({ 
        success: false, 
        error: 'Hotel account is inactive' 
      });
    }

    if (tenant.subscriptionExpiry && new Date(tenant.subscriptionExpiry) < new Date()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Subscription expired', 
        expiryDate: tenant.subscriptionExpiry,
        action: 'Please renew your subscription'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    next();
  }
};

module.exports = {
  checkSubscription
};