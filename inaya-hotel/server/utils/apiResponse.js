// Success response
const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

// Error response
const error = (res, message = 'Error', statusCode = 400, details = null) => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    details,
    timestamp: new Date().toISOString()
  });
};

// Created response
const created = (res, data = null, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

// Not found response
const notFound = (res, message = 'Resource not found') => {
  return error(res, message, 404);
};

module.exports = {
  success,
  error,
  created,
  notFound
};