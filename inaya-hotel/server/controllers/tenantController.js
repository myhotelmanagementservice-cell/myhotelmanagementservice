const { getDB, isConnected } = require('../config/db');
const { broadcast } = require('../utils/broadcast');
const { success, error } = require('../utils/apiResponse');

// Get tenant info
exports.getTenant = async (req, res) => {
  try {
    const hotelId = req.hotelId;

    const defaultData = { 
      hotelId, 
      hotelName: 'Crown Plaza Hotel',
      currency: 'USD',
      currencySymbol: '$',
      language: 'en',
      country: 'USA',
      active: true,
      theme: 'default',
      subscriptionType: 'basic'
    };

    if (!isConnected()) {
      return success(res, defaultData);
    }

    const db = getDB();
    const tenant = await db.collection('tenants').findOne({ hotelId });

    if (!tenant) {
      return success(res, defaultData);
    }

    return success(res, tenant);

  } catch (err) {
    console.error('Tenant fetch error:', err);
    return error(res, err.message, 500);
  }
};

// Save tenant config
exports.saveTenant = async (req, res) => {
  try {
    const hotelId = req.hotelId;
    const { hotelName, logo, currency, currencySymbol, language, country, active, theme, subscriptionType } = req.body;

    if (!isConnected()) {
      return success(res, { hotelId, hotelName }, 'Tenant config saved (offline mode)');
    }

    const db = getDB();
    const result = await db.collection('tenants').updateOne(
      { hotelId },
      { 
        $set: { 
          hotelName, 
          logo, 
          currency, 
          currencySymbol,
          language, 
          country, 
          active, 
          theme, 
          subscriptionType,
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    );

    broadcast(hotelId, 'cfg_upd', { hotelName, currency, currencySymbol, language, theme }, req.clientId);

    return success(res, { hotelId, hotelName }, result.upsertedCount ? 'Tenant created' : 'Tenant updated');

  } catch (err) {
    console.error('Tenant save error:', err);
    return error(res, err.message, 500);
  }
};