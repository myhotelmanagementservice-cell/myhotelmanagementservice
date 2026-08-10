const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const sessionSecret = process.env.SESSION_SECRET;
const configuredJwtSecret = process.env.JWT_SECRET;

if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters in production');
}

if (isProduction && configuredJwtSecret && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const sessionSecretValue = sessionSecret || 'development-session-secret-only';
const jwtSecret = configuredJwtSecret || crypto
  .createHmac('sha256', sessionSecretValue)
  .update('inaya-hotel-jwt-signing-key')
  .digest('hex');

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin && origin !== '*');

function corsOrigin(origin, callback) {
  // Same-origin browser requests do not send an Origin header.
  if (!origin) return callback(null, true);
  if (allowedOrigins.length === 0) return callback(null, false);
  return callback(null, allowedOrigins.includes(origin));
}

module.exports = {
  isProduction,
  sessionSecret: sessionSecretValue,
  jwtSecret,
  corsOrigin
};