// server/middleware/hotelContext.js
const getHotelId = (req) => {
  // Priority: Header -> Query Param -> Environment Default -> Dev Fallback
  const rawId = req.headers['x-hotel-id'] || req.query.hotelId || process.env.DEFAULT_HOTEL_ID || 'CPH001';
  // Normalize: trim whitespace & uppercase for consistent DB routing
  return String(rawId).trim().toUpperCase();
};

const validateHotelId = (hotelId) => {
  // Secure format: 3-50 chars, alphanumeric, hyphens, underscores only
  return /^[A-Z0-9_-]{3,50}$/.test(hotelId);
};

const hotelContext = (req, res, next) => {
  const hotelId = getHotelId(req);

  // 🔒 Validation: Reject malformed/unsafe IDs
  if (!validateHotelId(hotelId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_HOTEL_ID',
      message: 'Hotel ID must be 3-50 alphanumeric characters, hyphens, or underscores'
    });
  }

  req.hotelId = hotelId;
  res.setHeader('X-Hotel-Id', req.hotelId);

  // Optional: Log context for debugging (remove in production if verbose)
  // console.log(`🏨 Context: ${req.method} ${req.path} | Hotel: ${req.hotelId}`);

  next();
};

module.exports = hotelContext;