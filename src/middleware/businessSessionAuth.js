const { verifyToken } = require('../utils/tokens');
const pool = require('../db/pool');
const AppResponse = require('../utils/AppResponse');

async function businessSessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload || payload.type !== 'business') {
    return next(new AppResponse('Invalid or expired business session', 401));
  }

  const { rows } = await pool.query('SELECT id, name FROM businesses WHERE id = $1', [payload.businessId]);
  if (!rows[0]) return next(new AppResponse('Business not found', 401));

  req.business = rows[0];
  next();
}

module.exports = businessSessionAuth;