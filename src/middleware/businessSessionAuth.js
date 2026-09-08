const { verifyToken } = require('../utils/tokens');
const pool = require('../db/pool');

async function businessSessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload || payload.type !== 'business') {
    return res.status(401).json({ error: 'Invalid or expired business session' });
  }

  const { rows } = await pool.query('SELECT id, name FROM businesses WHERE id = $1', [payload.businessId]);
  if (!rows[0]) return res.status(401).json({ error: 'Business not found' });

  req.business = rows[0];
  next();
}

module.exports = businessSessionAuth;