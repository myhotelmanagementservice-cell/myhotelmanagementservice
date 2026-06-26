// server/utils/apiResponse.js
// Centralized API Response Handlers for Multi-Tenant Hotel SaaS
// ✅ Enhanced with auth, validation, pagination & error codes

// ============================================================
// SUCCESS RESPONSES
// ============================================================

// ✅ Generic Success (200)
const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

// ✅ Created (201) - For new resources
const created = (res, data = null, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

// ✅ Updated (200) - For updates
const updated = (res, data = null, message = 'Updated successfully') => {
  return success(res, data, message, 200);
};

// ✅ Deleted (200) - For deletions
const deleted = (res, message = 'Deleted successfully') => {
  return success(res, null, message, 200);
};

// ✅ No Content (204) - For successful operations with no response body
const noContent = (res) => {
  return res.status(204).send();
};

// ============================================================
// ERROR RESPONSES
// ============================================================

// ✅ Generic Error (400)
const error = (res, message = 'Error', statusCode = 400, details = null) => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    code: getErrorCode(statusCode),
    details,
    timestamp: new Date().toISOString()
  });
};

// ✅ Not Found (404)
const notFound = (res, message = 'Resource not found') => {
  return error(res, message, 404);
};

// ✅ Unauthorized (401) - For auth failures
const unauthorized = (res, message = 'Authentication required. Please login.') => {
  return error(res, message, 401);
};

// ✅ Forbidden (403) - For permission issues
const forbidden = (res, message = 'You do not have permission to perform this action') => {
  return error(res, message, 403);
};

// ✅ Conflict (409) - For duplicate entries (hotel ID, email, etc.)
const conflict = (res, message = 'Resource already exists') => {
  return error(res, message, 409);
};

// ✅ Validation Error (422) - For form validation failures
const validationError = (res, errors, message = 'Validation failed') => {
  return res.status(422).json({
    success: false,
    error: message,
    code: 'VALIDATION_ERROR',
    errors, // Array of { field, message } objects
    timestamp: new Date().toISOString()
  });
};

// ✅ Too Many Requests (429) - For rate limiting
const tooManyRequests = (res, message = 'Too many requests. Please try again later.') => {
  return error(res, message, 429);
};

// ✅ Server Error (500) - For internal errors
const serverError = (res, message = 'Internal server error', error = null) => {
  // Log the actual error for debugging (not sent to client)
  if (error) {
    console.error('❌ Server Error:', error.message || error);
    if (error.stack) console.error(error.stack);
  }

  return res.status(500).json({
    success: false,
    error: message,
    code: 'SERVER_ERROR',
    timestamp: new Date().toISOString()
  });
};

// ✅ Service Unavailable (503) - For DB connection issues
const serviceUnavailable = (res, message = 'Service temporarily unavailable. Please try again later.') => {
  return error(res, message, 503);
};

// ============================================================
// SPECIALIZED RESPONSES
// ============================================================

// ✅ Paginated Response - For list endpoints
const paginated = (res, data, pagination, message = 'Data retrieved successfully') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page || 1,
      limit: pagination.limit || 10,
      total: pagination.total || 0,
      totalPages: pagination.totalPages || 0,
      hasNext: pagination.hasNext || false,
      hasPrev: pagination.hasPrev || false
    },
    timestamp: new Date().toISOString()
  });
};

// ✅ Bulk Operation Response - For bulk create/update/delete
const bulkResponse = (res, results, message = 'Bulk operation completed') => {
  return res.status(200).json({
    success: true,
    message,
    data: {
      total: results.total || 0,
      successful: results.successful || 0,
      failed: results.failed || 0,
      errors: results.errors || []
    },
    timestamp: new Date().toISOString()
  });
};

// ✅ Login Response - Special format for auth
const loginSuccess = (res, { token, user, hotelId, hotelName }) => {
  return res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    user,
    hotelId,
    hotelName,
    timestamp: new Date().toISOString()
  });
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Get error code from status code
const getErrorCode = (statusCode) => {
  const codeMap = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'TOO_MANY_REQUESTS',
    500: 'SERVER_ERROR',
    503: 'SERVICE_UNAVAILABLE'
  };
  return codeMap[statusCode] || 'ERROR';
};

// Build validation errors array
const buildValidationErrors = (fields, values = {}) => {
  const errors = [];
  fields.forEach(field => {
    errors.push({
      field,
      message: `${field} is required`,
      value: values[field] || null
    });
  });
  return errors;
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Success responses
  success,
  created,
  updated,
  deleted,
  noContent,

  // Error responses
  error,
  notFound,
  unauthorized,
  forbidden,
  conflict,
  validationError,
  tooManyRequests,
  serverError,
  serviceUnavailable,

  // Specialized responses
  paginated,
  bulkResponse,
  loginSuccess,

  // Helpers
  getErrorCode,
  buildValidationErrors
};