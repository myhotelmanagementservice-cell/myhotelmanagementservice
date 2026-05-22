cat > server/middleware/hotelContext.js << 'EOF'
const getHotelId = (req) => {
  return req.headers['x-hotel-id'] || req.query.hotelId || process.env.DEFAULT_HOTEL_ID || 'CPH001';
};

const hotelContext = (req, res, next) => {
  req.hotelId = getHotelId(req);
  res.setHeader('X-Hotel-Id', req.hotelId);
  next();
};

module.exports = hotelContext;
EOF