// Extract hotel ID from request
const getHotelId = (req) => {
  return req.headers['x-hotel-id'] || 
         req.query.hotelId || 
         req.query.hotel || 
         (req.session?.hotelId) || 
         'default';
};

// Tenant middleware
const tenantMiddleware = (req, res, next) => {
  req.hotelId = getHotelId(req);
  next();
};

// Client info middleware
const clientInfoMiddleware = (req, res, next) => {
  req.clientId = req.headers['x-client-id'] || null;
  next();
};

module.exports = {
  getHotelId,
  tenantMiddleware,
  clientInfoMiddleware
};