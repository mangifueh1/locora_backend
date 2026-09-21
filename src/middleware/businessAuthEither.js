const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { verifyToken } = require('../utils/tokens');

// Accepts either an API key (business_id.raw_key) or a dashboard session JWT.
async function businessAuthEither(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');

  // Try session JWT first — cheap check, no DB hit if it doesn't even parse.
  const payload = verifyToken(token);
  if (payload && payload.type === 'business') {
    const { rows } = await pool.query('SELECT id, name FROM businesses WHERE id = $1', [payload.businessId]);
    if (rows[0]) {
      req.business = rows[0];
      return next();
    }
  }

  // Fall back to API key format: business_id.raw_key
  const [businessId, rawKey] = token.split('.');
  if (businessId && rawKey) {
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const business = rows[0];
    if (business && await bcrypt.compare(rawKey, business.api_key_hash)) {
      req.business = business;
      return next();
    }
  }

  return res.status(401).json({ error: 'Invalid business credentials' });
}

module.exports = businessAuthEither;